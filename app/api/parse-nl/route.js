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
      orgName: d.data().orgName || "",
      targetProduct: d.data().targetProduct || "",
    }));

    const list = deals.map((d, i) => `${i}: ${d.orgName} - ${d.targetProduct}`).join("\n");
    const today = new Date().toISOString().slice(0, 10);

    const prompt = `다음은 회사 세일즈 파이프라인의 딜 목록입니다 (인덱스: 업체명 - 타겟제품):
${list}

오늘 날짜는 ${today}입니다.

사용자가 아래 문장으로 진행 상황을 보고했습니다. 이 문장이 위 목록 중 어떤 딜에 대한 것인지 찾아서, 날짜와 액션 내용을 추출해주세요. 날짜가 명시 안되어 있으면 오늘 날짜를 씁니다.

문장: "${text}"

아래 JSON 형식으로만 답하세요 (다른 설명이나 코드블록 없이 순수 JSON만):
{"dealIndex": <목록의 인덱스 숫자 또는 매칭 안되면 null>, "date": "YYYY-MM-DD", "actionText": "정리된 액션 내용 한 문장"}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
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

    let matched = null;
    if (parsed.dealIndex !== null && parsed.dealIndex !== undefined && deals[parsed.dealIndex]) {
      matched = deals[parsed.dealIndex];
    }

    return NextResponse.json({
      dealId: matched ? matched.id : null,
      orgName: matched ? matched.orgName : null,
      targetProduct: matched ? matched.targetProduct : null,
      date: parsed.date || today,
      actionText: parsed.actionText || text,
      allDeals: deals,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
