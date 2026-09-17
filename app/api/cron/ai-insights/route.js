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

// 키워드 → 테크핀 영업프로세스 단계 매핑 (통상 7일 기준 공통 적용)
const KEYWORD_STAGES = [
  { label: "PoC/시연/테스트", keywords: ["PoC", "poc", "시연", "테스트", "데모", "시범"], processStep: "6단계 [컨설팅] PoC 결과 분석 및 제안" },
  { label: "견적/제안", keywords: ["견적", "제안서", "제안"], processStep: "3단계 [유관부서별 접촉] 제안 단계" },
  { label: "NDA/계약서 검토", keywords: ["NDA", "계약서", "계약 검토", "법무검토", "법무 검토"], processStep: "4단계 [동의확보 MOU]" },
  { label: "미팅 예정/일정조율", keywords: ["미팅", "방문", "일정 조율", "일정조율", "미팅예정"], processStep: "3단계 [유관부서별 접촉]" },
  { label: "회신 대기", keywords: ["회신", "검토 중", "검토중", "답변 대기", "회신 대기"], processStep: "진행 중 (부서 내부 검토)" },
];
const THRESHOLD_DAYS = 7;

function matchKeywordStage(text) {
  if (!text) return null;
  for (const k of KEYWORD_STAGES) {
    if (k.keywords.some((kw) => text.includes(kw))) return k;
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") || "").trim();
  const isVercelCron = request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const expected = (process.env.ACCESS_CODE || "").trim();
  if (!isVercelCron && code !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);

    const [dealsSnap, activitySnap] = await Promise.all([
      db.collection("deals").get(),
      db.collection("activityLog").get(),
    ]);
    const deals = dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const activityByDeal = {};
    activitySnap.forEach((doc) => {
      const a = doc.data();
      if (!a.dealId || !a.date) return;
      if (!activityByDeal[a.dealId] || a.date > activityByDeal[a.dealId].date) {
        activityByDeal[a.dealId] = a;
      }
    });

    const today = new Date();
    let flagged = 0, cleared = 0, aiCalled = 0;
    const batch = db.batch();

    for (const d of deals) {
      if (d.stage === "4단계" || d.probability === "완료") {
        if (d.aiFlag) {
          batch.update(db.collection("deals").doc(d.id), { aiFlag: false, aiInsight: null });
          cleared++;
        }
        continue;
      }
      const last = activityByDeal[d.id];
      const currentActionText = last?.text || "";
      const daysSince = last ? Math.floor((today - new Date(last.date)) / 86400000) : null;
      const stageMatch = matchKeywordStage(currentActionText);

      const shouldFlag = stageMatch && daysSince !== null && daysSince >= THRESHOLD_DAYS && daysSince <= 30;

      if (!shouldFlag) {
        if (d.aiFlag) {
          batch.update(db.collection("deals").doc(d.id), { aiFlag: false, aiInsight: null });
          cleared++;
        }
        continue;
      }

      // 이미 같은 액션 텍스트로 인사이트 생성해뒀으면 재호출 안함
      if (d.aiFlag && d.aiInsightForAction === currentActionText) {
        continue;
      }
      // 담당자가 같은 액션 내용에 대해 이미 해제(dismiss)했으면 재생성 안함 (액션 내용이 바뀌면 다시 판단)
      if (d.aiDismissedForAction === currentActionText) {
        continue;
      }

      const prompt = `당신은 B2B 데이터 세일즈 담당자를 돕는 어시스턴트입니다.
아래는 한 영업 딜의 최근 액션 내용과 경과일수입니다.

최근 액션: "${currentActionText}"
경과일수: ${daysSince}일
추정 프로세스 단계: ${stageMatch.processStep}

이 상황에서 담당 영업사원에게 보여줄, 한국어로 된 한 문장짜리 짧은 리마인드 멘트를 만들어주세요.
형식: "[상황 요약], [제안하는 다음 액션]" 형태로, 25자 내외로 간결하게. 다른 설명 없이 문장만 출력하세요.`;

      try {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 150,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const aiData = await aiRes.json();
        const insight = aiData.content?.[0]?.text?.trim();
        if (insight) {
          batch.update(db.collection("deals").doc(d.id), {
            aiFlag: true,
            aiInsight: insight,
            aiInsightForAction: currentActionText,
            aiInsightDate: today.toISOString().slice(0, 10),
          });
          flagged++;
          aiCalled++;
        }
      } catch (e) {
        // 개별 실패는 건너뜀
      }
    }

    // ── 계약갱신일 AI 자동추론 (완료된 계약인데 계약갱신일이 아직 없는 딜만, 1회성) ──
    let renewalInferred = 0;
    for (const d of deals) {
      if (d.probability !== "완료" || d.contractRenewalDate) continue;

      const renewalPrompt = `다음은 완료된 계약 정보입니다. 이런 기업정보 데이터/플랫폼 계약은 보통 1년 단위로 갱신됩니다.

업체명: ${d.orgName}
타겟제품: ${d.targetProduct || ""}
계약목표(완료시점 표기): "${d.contractGoal || ""}"
오늘 날짜: ${today.toISOString().slice(0, 10)}

"계약목표" 표기(예: "5월", "25년12월", "기존계약(완료)")를 바탕으로 이 계약이 언제 체결(완료)되었는지 최대한 합리적으로 추정하고, 거기에 1년을 더해 다음 계약 갱신일을 계산해주세요.
- 연도가 명시 안 되어 있으면(예: "5월") 가장 최근에 그 달이 지난 시점으로 가정하세요.
- "기존계약(완료)"처럼 시점 정보가 전혀 없으면 추정하지 마세요.
- 확신이 없으면 절대 추측하지 말고 null로 답하세요.

아래 JSON 형식으로만 답하세요: {"renewalDate": "YYYY-MM-DD 또는 null"}`;

      try {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 100,
            messages: [{ role: "user", content: renewalPrompt }],
          }),
        });
        const aiData = await aiRes.json();
        const raw = aiData.content?.[0]?.text || "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (parsed?.renewalDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.renewalDate)) {
          batch.update(db.collection("deals").doc(d.id), {
            contractRenewalDate: parsed.renewalDate,
            contractRenewalInferredByAI: true,
          });
          renewalInferred++;
        }
      } catch (e) {
        // 개별 실패는 건너뜀
      }
    }

    await batch.commit();
    return NextResponse.json({ message: "완료", flagged, cleared, aiCalled, renewalInferred, totalDeals: deals.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
