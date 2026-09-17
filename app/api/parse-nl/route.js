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

async function getFieldSuggestions(db, dealId, text) {
  const fullDoc = await db.collection("deals").doc(dealId).get();
  if (!fullDoc.exists) return [];
  const fd = fullDoc.data();

  const fieldPrompt = `당신은 B2B 데이터 세일즈 파이프라인 관리를 돕는 어시스턴트입니다. 담당 영업사원이 방금 진행상황을 한 문장으로 보고했고, 그 문장을 바탕으로 이 딜의 필드 중 실제로 값이 바뀌어야 할 것 같은 항목을 찾아내는 게 당신의 역할입니다.

[현재 딜 정보]
업체명: ${fd.orgName}
타겟제품: ${fd.targetProduct || "미입력"}
담당자(고객사 측 담당자): ${fd.contactPerson || "미입력"}
RM: ${fd.rm || "미입력"}
SO: ${fd.so || "미입력"}
기대실적: ${fd.expectedPerformanceRaw || fd.expectedPerformance || "미입력"}
계약금액: ${fd.contractAmount || "미입력"}
계약목표(시점): ${fd.contractGoal || "미입력"}
계약갱신일: ${fd.contractRenewalDate || "미입력"}
진행단계: ${fd.stage || "미입력"} (1단계=데이터/상품소개, 2단계=유관부서세분화, 3단계=유관부서접촉/미팅·PoC 진행, 4단계=계약·MOU 체결)
계약가능성: ${fd.probability || "미입력"} (상=가능성높음/중=보통/하=낮음/완료=계약체결됨)
방문미팅: ${fd.visitMeetingRaw || "미입력"}
메모: ${fd.memo || "미입력"}
다음 액션: ${fd.nextAction || "미입력"}
다음 액션 실행 예정일: ${fd.nextActionDate || "미입력"}

[사용자 보고]
"${text}"

[필드별 판단 기준과 예시 — 이런 패턴이 문장에 있으면 반드시 제안하세요. 아래 없는 필드라도 문장에서 명확히 바뀐다고 언급되면 제안하세요]

1. contactPerson (고객사 담당자 변경): "담당자가 OOO로 바뀌었어", "담당자 OOO로 변경", "이제 OOO가 담당한대" → suggestedValue는 새 담당자 이름(직함 포함해도 됨)만.

2. rm / so (내부 담당 RM·SO 변경): "이제 RM은 OOO로", "SO가 OOO로 바뀜", "OOO가 이 건 맡기로 함" → 문장에서 RM인지 SO인지 명확할 때만 제안.

3. targetProduct (타겟제품 변경): 현재 타겟제품과 다른 제품·상품명이 새로 논의되고 있다는 게 명확할 때만.

4. expectedPerformanceRaw (기대실적 수정): "기대실적을 3억으로 수정하려고", "예상 매출 5천만원 정도로 조정" 처럼 금액이 명시되면 → suggestedValue는 "3억원", "5천만원"처럼 사람이 쓰는 표현 그대로.

5. contractAmount (계약금액 수정): "계약금액 1억으로 확정", "계약금액을 8천만원으로 수정" 처럼 실제 계약금액이 언급되면 → suggestedValue는 사람이 쓰는 금액 표현 그대로(예: "1억원").

6. contractGoal (계약목표 시점 수정): "계약목표를 11월로", "12월 안에 계약하기로" 처럼 목표 시점이 언급되면.

7. contractRenewalDate (계약갱신일): 문장에 재계약/갱신 관련 날짜가 명시되면 YYYY-MM-DD로.

8. stage (진행단계): 아래처럼 단계가 실제로 넘어갔다고 볼 수 있는 표현이 있으면 제안.
   - "계약하기로 했다", "계약서에 서명함", "정식 계약 체결" → 4단계
   - "미팅 잡았다/했다", "담당부서와 만났다", "PoC 시작함/진행중" → 아직 3단계면 그대로(이미 3단계면 제안 안 함), 1~2단계였다면 3단계로 상향 제안
   - 진행단계가 이미 그 상태와 일치하면 제안하지 않음(중복 제안 금지)

9. probability (계약가능성):
   - "계약 완료", "사인함", "계약서 작성 완료" → "완료"
   - "긍정적", "가능성 높아졌다", "거의 확정적" → "상"
   - "어려울 것 같다", "예산이 없대서 보류", "다른 곳으로 갈 듯" → "하"
   - "PoC 결과가 좋게 나왔다" 같은 긍정 신호는 "상"으로 올리는 걸 검토

10. visitMeetingRaw (방문미팅 메모): 방문/미팅 관련 새로운 일정성 정보가 있는데 다음미팅(별도 처리됨)과는 다른, 방문 이력 성격의 내용이면.

11. memo (메모 추가): 문장에 향후 참고할 만한 새로운 배경정보(예산 상황, 의사결정권자, 경쟁사 언급, 내부 사정 등)가 있는데 기존 메모에는 없는 내용이면, 기존 메모 뒤에 이어붙인 전체 텍스트를 suggestedValue로 제시. 단순히 활동 로그에 이미 들어갈 내용(미팅했다, PoC 했다 정도)은 메모로 중복 제안하지 않음.

12. nextAction (다음 액션): 문장에 다음 계획이 전혀 없고, 상황상 다음에 뭘 해야 할지 자연스럽게 유추 가능하면 제안. 만약 그 다음 액션을 언제까지/언제 하기로 했는지 날짜가 문장에 있거나 유추 가능하면(예: "다음주까지 견적서 보내야 함", "이번달 말까지 계약 진행"), nextActionDate 항목도 별도로 함께 제안하세요(YYYY-MM-DD, 오늘 날짜 기준 계산).

13. nextActionDate (다음 액션 실행 예정일): 다음 액션에 날짜/기한이 명확히 언급되면 위 12번과 별도 항목으로 제안 (다음 액션 텍스트 자체는 안 바뀌어도 날짜만 새로 언급되면 이것만 제안 가능).

사용자가 "OOO 수정하려고 해", "OOO 바꿔야 하는데", "OOO 업데이트 필요" 처럼 특정 필드를 콕 집어 언급하면, 실제 새 값이 문장에 없어도 그 필드의 currentValue와 함께 제안 항목을 만들고 suggestedValue는 currentValue와 동일하게 두어 사용자가 직접 채우도록 하세요 (수정하려는 의도 자체가 신호입니다).

애매하면 억지로 만들지 말고 제안하지 마세요. 근거가 명확한 것만 제안합니다 (빈 배열도 정상).

아래 JSON 배열로만 답하세요 (다른 설명 없이):
[{"field": "contactPerson|rm|so|targetProduct|expectedPerformanceRaw|contractAmount|contractGoal|contractRenewalDate|stage|probability|visitMeetingRaw|memo|nextAction|nextActionDate 중 하나", "label": "한글 라벨", "currentValue": "현재값(짧게)", "suggestedValue": "제안값", "reason": "왜 이렇게 제안하는지 한 문장"}]`;

  try {
    const { text: raw } = await callClaude(fieldPrompt, 500);
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    const parsed = arrMatch ? JSON.parse(arrMatch[0]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const text = (body.text || "").trim();
  const providedDealId = body.dealId || null;
  if (!text) {
    return NextResponse.json({ error: "텍스트를 입력해주세요." }, { status: 400 });
  }

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);

    // ── 클라이언트가 이미 딜을 확정한 경우(사용자가 타겟제품을 직접 선택) — 필드제안만 다시 계산 ──
    if (providedDealId) {
      const fieldSuggestions = await getFieldSuggestions(db, providedDealId, text);
      return NextResponse.json({ fieldSuggestions });
    }

    const snap = await db.collection("deals").get();
    const deals = snap.docs.map((d) => ({
      id: d.id,
      orgName: (d.data().orgName || "").trim(),
      targetProduct: d.data().targetProduct || "",
    }));

    const orgNames = [...new Set(deals.map((d) => d.orgName).filter(Boolean))];
    const orgList = orgNames.map((n, i) => `${i}: ${n}`).join("\n");
    const dealList = deals.map((d, i) => `${i}: ${d.orgName} - ${d.targetProduct}`).join("\n");
    const today = new Date().toISOString().slice(0, 10);

    const prompt = `[회사 목록] (인덱스: 회사명)
${orgList}

[딜 목록] (인덱스: 업체명 - 타겟제품)
${dealList}

오늘 날짜는 ${today}입니다 (요일 계산 시 참고).

사용자가 아래 문장을 입력했습니다.

문장: "${text}"

분석 항목:
1. 이 문장이 [회사 목록] 중 어느 회사에 대한 것인지 orgIndex를 찾으세요. 회사명이 정확히 일치하지 않아도 가장 유사한 회사를 찾아주세요 (예: 축약형, 별칭 등). 못 찾으면 null.
2. 그 회사에 여러 딜(타겟제품)이 있을 수 있습니다. 문장에서 특정 제품이 명확히 언급되면 [딜 목록]에서 해당 dealIndex를 찾으세요. 어느 제품인지 특정할 수 없으면(그래도 orgIndex는 찾았다면) dealIndex는 null로 두세요. orgIndex를 못 찾았으면 dealIndex도 null입니다.
3. 의도가 "register"(새 진행상황 등록)인지 "cancel"(이전에 등록한 내용을 취소/삭제해달라는 요청)인지 구분하세요.
4. 문장에 날짜가 명시 안되어 있으면 오늘 날짜를 씁니다.
5. 문장에 "다음주 화요일 미팅", "9/23 미팅 예정"처럼 **향후(미래) 예정된** 미팅/일정이 언급되면, 오늘 날짜 기준으로 정확한 날짜(YYYY-MM-DD)를 계산하세요. **주의: "미팅했다", "미팅 진행함", "다녀왔어", "회의록 작성했어"처럼 이미 끝난(과거) 미팅을 설명하는 문장은 향후 미팅이 아닙니다 — 이 경우 meetingDate는 반드시 null입니다.** 향후 일정 언급이 전혀 없으면 null.

아래 JSON 형식으로만 답하세요 (다른 설명이나 코드블록 없이 순수 JSON만):
{"orgIndex": <인덱스 또는 null>, "dealIndex": <인덱스 또는 null>, "intent": "register 또는 cancel", "date": "YYYY-MM-DD", "actionText": "정리된 액션 내용 한 문장", "meetingDate": "YYYY-MM-DD 또는 null", "meetingNote": "미팅 관련 짧은 메모 또는 null"}`;

    const { ok, text: raw, error } = await callClaude(prompt, 350);
    if (!ok) {
      return NextResponse.json({ error: error || "AI 분석 실패" }, { status: 500 });
    }

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      return NextResponse.json({ error: "AI 응답 해석 실패: " + raw }, { status: 500 });
    }

    let matchedOrg = null;
    if (parsed.orgIndex !== null && parsed.orgIndex !== undefined && orgNames[parsed.orgIndex]) {
      matchedOrg = orgNames[parsed.orgIndex];
    }

    let matchedDeal = null;
    if (parsed.dealIndex !== null && parsed.dealIndex !== undefined && deals[parsed.dealIndex]) {
      const cand = deals[parsed.dealIndex];
      if (!matchedOrg || cand.orgName === matchedOrg) matchedDeal = cand;
    }

    // URL 추출은 정규식으로 확정 (AI가 놓치는 경우가 있어 신뢰도를 위해 직접 처리)
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    const relatedFileUrl = urlMatch ? urlMatch[0] : null;
    let relatedFileLabel = null;
    if (text.includes("회의록")) relatedFileLabel = "회의록";
    else if (text.includes("제안서")) relatedFileLabel = "제안서";
    else if (text.includes("견적서")) relatedFileLabel = "견적서";
    else if (text.includes("계약서")) relatedFileLabel = "계약서";
    else if (text.includes("자료")) relatedFileLabel = "참고자료";
    else if (relatedFileUrl) relatedFileLabel = "첨부자료";

    let fieldSuggestions = [];
    if (matchedDeal && parsed.intent !== "cancel") {
      fieldSuggestions = await getFieldSuggestions(db, matchedDeal.id, text);
    }

    return NextResponse.json({
      intent: parsed.intent === "cancel" ? "cancel" : "register",
      orgName: matchedOrg,
      dealId: matchedDeal ? matchedDeal.id : null,
      targetProduct: matchedDeal ? matchedDeal.targetProduct : null,
      date: parsed.date || today,
      actionText: parsed.actionText || text,
      meetingDate: parsed.meetingDate || null,
      meetingNote: parsed.meetingNote || null,
      relatedFileUrl,
      relatedFileLabel,
      fieldSuggestions,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
