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

function classifyDeal(d, curMonth, nextMonth) {
  const isDone = (d.stage || "").includes("4") || d.probability === "완료";
  return isDone;
}

async function sendKakaoWorkDM(email, text) {
  const res = await fetch("https://api.kakaowork.com/v1/messages.send_by_email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KAKAOWORK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, text }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.success !== false, data };
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

    const [usersSnap, dealsSnap, activitySnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("deals").get(),
      db.collection("activityLog").get(),
    ]);
    const users = usersSnap.docs.map((d) => d.data()).filter((u) => u.kakaoworkEmail);
    const deals = dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const lastActionByDeal = {};
    activitySnap.forEach((doc) => {
      const a = doc.data();
      if (!a.dealId || !a.date) return;
      if (!lastActionByDeal[a.dealId] || a.date > lastActionByDeal[a.dealId]) lastActionByDeal[a.dealId] = a.date;
    });

    const now = new Date();
    let sent = 0;
    const results = [];

    for (const u of users) {
      const myDeals = deals.filter((d) => d.rm === u.name || d.so === u.name);

      const actionDue = myDeals.filter((d) => {
        if (d.nextMeetingDate) {
          const diff = Math.floor((new Date(d.nextMeetingDate) - now) / 86400000);
          if (diff >= 0 && diff <= 7) return true;
        }
        if (d.contractRenewalDate) {
          const diff = Math.floor((new Date(d.contractRenewalDate) - now) / 86400000);
          if (diff >= 0 && diff <= 30) return true;
        }
        return false;
      });

      const aiFlagged = myDeals.filter((d) => d.aiFlag);

      if (actionDue.length === 0 && aiFlagged.length === 0) continue;

      let text = `📋 오늘의 파이프라인 요약 (${u.name}님)\n`;
      if (actionDue.length > 0) {
        text += `\n🟠 액션 도래 (${actionDue.length}건)\n`;
        actionDue.slice(0, 5).forEach((d) => {
          const when = d.contractRenewalDate && (!d.nextMeetingDate) ? `계약갱신 ${d.contractRenewalDate}` : `${d.nextMeetingDate} ${d.nextMeetingNote || ""}`;
          text += `· ${d.orgName} (${(d.targetProduct || "").replace(/\n/g, " ")}) - ${when}\n`;
        });
      }
      if (aiFlagged.length > 0) {
        text += `\n✨ AI 추천 액션 (${aiFlagged.length}건)\n`;
        aiFlagged.slice(0, 5).forEach((d) => {
          text += `· ${d.orgName}: ${d.aiInsight}\n`;
        });
      }
      text += `\n👉 https://pipelinedashboard-kl6j.vercel.app/`;

      const result = await sendKakaoWorkDM(u.kakaoworkEmail, text);
      results.push({ email: u.kakaoworkEmail, ok: result.ok });
      if (result.ok) sent++;
    }

    return NextResponse.json({ message: "완료", targetUsers: users.length, sent, results });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
