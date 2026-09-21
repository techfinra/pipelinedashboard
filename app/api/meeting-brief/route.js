import { NextResponse } from "next/server";
import admin from "firebase-admin";

function getAdminApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

async function callClaude(prompt, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return { ok: res.ok, text: data.content?.[0]?.text || "", error: data.error?.message };
}

const PURPOSE_LABELS = {
  first: "첫 미팅 준비 — 기업 및 사업 이해, 예상 니즈와 질문 중심",
  followup: "후속 미팅 준비 — 기존 논의사항, 미결 과제, 다음 액션 중심",
  proposal: "제품 제안 미팅 — 타겟 제품별 니즈와 제안 포인트 중심",
  poc: "PoC 협의 — PoC 범위, 확인사항, 의사결정 포인트 중심",
  contract: "계약/예산 협의 — 검토 현황, 장애요인, 계약·예산 관련 포인트 중심",
  reactivate: "관계 재활성화 — 장기간 접촉이 없었던 기업의 최근 변화와 재접촉 명분 중심",
};

function fmtDate(d) {
  return d || "미상";
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const orgName = (body.orgName || "").trim();
  const purposeKey = body.purpose || "";
  const freeText = (body.freeText || "").trim();

  if (!orgName) {
    return NextResponse.json({ error: "기업을 선택해주세요." }, { status: 400 });
  }

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);

    const [dealsSnap, activitySnap] = await Promise.all([
      db.collection("deals").get(),
      db.collection("activityLog").get(),
    ]);

    const allDeals = dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const orgDeals = allDeals.filter((d) => (d.orgName || "").trim() === orgName);
    if (orgDeals.length === 0) {
      return NextResponse.json({ error: "해당 기업의 딜 정보를 찾을 수 없습니다." }, { status: 404 });
    }
    const dealIds = new Set(orgDeals.map((d) => d.id));

    const allActivity = activitySnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => dealIds.has(a.dealId));

    const dealById = {};
    orgDeals.forEach((d) => { dealById[d.id] = d; });

    // ── 기업 기본정보 ──
    const contacts = [...new Set(orgDeals.map((d) => d.contactPerson).filter(Boolean))];
    const stages = orgDeals.map(
      (d) => `${d.targetProduct || "제품미상"}: ${d.stage || "단계미상"} (계약가능성: ${d.probability || "미상"})`
    );
    const upcomingMeetings = orgDeals
      .filter((d) => d.nextMeetingDate)
      .sort((a, b) => (a.nextMeetingDate || "").localeCompare(b.nextMeetingDate || ""));
    const nextMeeting = upcomingMeetings[0];

    // ── 타겟 제품 ──
    const targetProducts = [...new Set(orgDeals.map((d) => d.targetProduct).filter(Boolean))];

    // ── 제품별 영업 히스토리 ──
    const productActionHistory = orgDeals
      .map((d) => {
        const items = allActivity
          .filter((a) => a.dealId === d.id)
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
          .map((a) => `  - ${fmtDate(a.date)}: ${a.text}`)
          .join("\n");
        return `[${d.targetProduct || "제품미상"}]\n${items || "  - 등록된 히스토리 없음"}`;
      })
      .join("\n\n");

    // ── 전체 접촉/액션 이력 (최신순 15건) ──
    const actionHistory = allActivity
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 15)
      .map((a) => `- ${fmtDate(a.date)} [${dealById[a.dealId]?.targetProduct || "제품미상"}]: ${a.text}`)
      .join("\n") || "등록된 이력 없음";

    // ── 이전 미팅 및 논의사항 / 미결사항 ──
    const meetingNotes = orgDeals
      .filter((d) => d.nextMeetingNote || d.memo)
      .map((d) => {
        const parts = [];
        if (d.nextMeetingNote) parts.push(`다음미팅 메모: ${d.nextMeetingNote}`);
        if (d.memo) parts.push(`메모: ${d.memo}`);
        return `[${d.targetProduct || "제품미상"}] ${parts.join(" / ")}`;
      })
      .join("\n") || "기록된 논의사항 없음";

    const openItems = orgDeals
      .filter((d) => d.nextAction)
      .map((d) => `[${d.targetProduct || "제품미상"}] ${d.nextAction}${d.nextActionDate ? ` (기한: ${d.nextActionDate})` : ""}`)
      .join("\n") || "등록된 미결 액션 없음";

    const purposeText = purposeKey && PURPOSE_LABELS[purposeKey]
      ? PURPOSE_LABELS[purposeKey] + (freeText ? `\n추가 입력: ${freeText}` : "")
      : (freeText || "담당자가 별도로 입력한 목적 없음");

    const today = new Date().toISOString().slice(0, 10);

    const prompt = `너는 B2B 금융·기업데이터 서비스 영업 담당자를 지원하는 '미팅 사전 준비 AI'다.

아래 정보를 종합하여 담당자가 미팅 직전 5분 이내에 읽고 바로 활용할 수 있는 미팅 사전 보고서를 작성하라.

오늘 날짜: ${today}

[이번 미팅 목적]
${purposeText}

[고객사 기본정보]
회사명: ${orgName}
소속 그룹/분류: ${orgDeals[0]?.orgGroup || "미상"}
담당자(고객사측): ${contacts.join(", ") || "미상"}
현재 영업단계(제품별): ${stages.join(" / ") || "미상"}
다음 미팅 일시: ${nextMeeting ? `${nextMeeting.nextMeetingDate} (${nextMeeting.targetProduct || ""})` : "예정된 미팅 없음"}

[타겟 제품]
${targetProducts.join(", ") || "미상"}

[제품별 영업 히스토리]
${productActionHistory}

[전체 접촉/액션 이력 (최신순)]
${actionHistory}

[이전 미팅 및 논의사항 / 메모]
${meetingNotes}

[현재 미결사항 / 다음 액션]
${openItems}

[최근 뉴스 및 외부 정보]
제공된 외부 뉴스 데이터 없음. 5번 섹션은 이 사실을 그대로 밝히고 추측성 내용을 만들지 마라. (담당자가 위 미팅 목적란에 관련 뉴스나 배경을 직접 적었다면 그 내용만 참고하라.)

보고서 작성 원칙:
1. 단순히 과거 이력을 나열하지 말고 현재 미팅에 중요한 정보만 선별한다.
2. 내부 영업 히스토리와 (있다면) 배경 정보를 연결해서 의미를 분석한다.
3. 사실과 AI의 추론을 구분한다.
4. 확인되지 않은 내용을 사실처럼 작성하지 않는다. 데이터가 없으면 "정보 없음"이라고 명시한다.
5. 고객사가 실제로 언급한 니즈와 AI가 추정한 니즈를 구분한다.
6. 타겟 제품별로 이번 미팅에서 어떤 이야기를 해야 하는지 제시한다.
7. 이미 이전 미팅에서 확인한 내용을 다시 질문하지 않도록 한다.
8. 외부 뉴스 데이터가 없으면 5번 섹션에서 그 사실만 간단히 밝히고 없는 내용을 지어내지 않는다.
9. 너무 일반적인 영업 조언은 제외하고 해당 고객사에 특화된 내용만 작성한다.
10. 전체 보고서는 미팅 직전 빠르게 읽을 수 있도록 간결하게 작성한다.

다음 형식으로 작성하라 (마크다운).

# ${orgName} 미팅 사전 Brief

## 1. 이번 미팅 한눈에 보기
- 미팅 목적
- 현재 영업 단계
- 주요 타겟 제품
- 지금 가장 중요한 포인트 3개

## 2. 지금까지의 진행 상황
중요한 접촉 및 액션을 시간순으로 5~8개 이내 요약. 각 액션이 현재 미팅에 어떤 의미가 있는지도 간략하게 표시.

## 3. 이전 논의에서 확인된 고객 니즈
### 고객이 직접 언급한 니즈
### 현재 상황에서 추가로 예상되는 니즈

## 4. 제품별 현황 및 공략 포인트
각 타겟 제품별로 아래를 작성.
- 현재 진행 단계
- 지금까지 고객 반응
- 고객 니즈와 연결점
- 이번 미팅에서 확인할 사항
- 제안할 포인트
- 예상 장애요인

## 5. 최근 뉴스 / 환경 변화
외부 뉴스 데이터가 제공되지 않았으면 그 사실만 밝힌다. 담당자가 입력한 배경정보가 있으면 그 내용의 의미만 분석한다.

## 6. 미팅에서 반드시 확인할 질문
우선순위 순으로 5~7개 작성. 과거에 이미 답변받은 질문은 제외.

## 7. 추천 대화 흐름
미팅 시작 → 현황 확인 → 니즈 심화 → 제품 제안 → 다음 액션 순서로 실제 미팅에서 사용할 수 있도록 제안.

## 8. 예상 반론 및 대응
현재 히스토리를 바탕으로 나올 가능성이 높은 반론 또는 우려와 이에 대한 대응 방향을 작성.

## 9. 이번 미팅의 목표
- 최소 목표
- 기대 목표
- 미팅 종료 전 반드시 합의할 Next Action

마지막으로 아래 한 줄을 작성하라.

"이번 미팅 핵심 전략: ________"`;

    const { ok, text, error } = await callClaude(prompt, 4000);
    if (!ok || !text) {
      return NextResponse.json({ error: error || "보고서 생성 실패" }, { status: 500 });
    }

    return NextResponse.json({ report: text });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
