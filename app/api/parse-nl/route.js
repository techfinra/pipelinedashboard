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

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "텍스트를 입력해주세요." }, { status: 400 });
  }

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);
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
5. 문장에 "다음주 화요일 미팅", "9/23 미팅 예정" 처럼 향후 예정된 미팅/일정이 언급되면, 오늘 날짜 기준으로 정확한 날짜(YYYY-MM-DD)를 계산하세요. 언급 없으면 null.
6. 문장 내용이 다소 간단하거나(예: "PoC 진행한거 등록하려고 해") 향후 계획이 불명확하면, 담당자에게 도움이 될 만한 "다음 액션" 제안을 한 문장으로 만들어주세요 (예: PoC 언급이면 "PoC 결과 공유 및 후속 미팅 제안" 등 영업프로세스 관점에서 자연스러운 다음 단계). 이미 다음 액션이 문장에 명확히 포함돼 있으면 null로 두세요. 이건 선택사항이므로 억지로 만들지 말고, 자신 없으면 null.

아래 JSON 형식으로만 답하세요 (다른 설명이나 코드블록 없이 순수 JSON만):
{"orgIndex": <인덱스 또는 null>, "dealIndex": <인덱스 또는 null>, "intent": "register 또는 cancel", "date": "YYYY-MM-DD", "actionText": "정리된 액션 내용 한 문장", "meetingDate": "YYYY-MM-DD 또는 null", "meetingNote": "미팅 관련 짧은 메모 또는 null", "suggestedNextAction": "다음 액션 제안 문장 또는 null"}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 350,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      return NextResponse.json({ error: aiData.error?.message || "AI 분석 실패" }, { status: 500 });
    }

    const raw = aiData.content?.[0]?.text || "";
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

    return NextResponse.json({
      intent: parsed.intent === "cancel" ? "cancel" : "register",
      orgName: matchedOrg,
      dealId: matchedDeal ? matchedDeal.id : null,
      targetProduct: matchedDeal ? matchedDeal.targetProduct : null,
      date: parsed.date || today,
      actionText: parsed.actionText || text,
      meetingDate: parsed.meetingDate || null,
      meetingNote: parsed.meetingNote || null,
      suggestedNextAction: parsed.suggestedNextAction || null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
