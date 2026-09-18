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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") || "").trim();
  const expected = (process.env.ACCESS_CODE || "").trim();
  if (!code || code !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const app = getAdminApp();
  const db = admin.firestore(app);
  const [dealsSnap, activitySnap, droppedSnap] = await Promise.all([
    db.collection("deals").get(),
    db.collection("activityLog").get(),
    db.collection("droppedCompanies").get(),
  ]);
  const droppedNames = new Set(droppedSnap.docs.map((d) => d.id));

  const lastActionByDeal = {};
  activitySnap.forEach((doc) => {
    const a = doc.data();
    if (!a.dealId || !a.date) return;
    if (!lastActionByDeal[a.dealId] || a.date > lastActionByDeal[a.dealId]) lastActionByDeal[a.dealId] = a.date;
  });

  const today = new Date();
  const result = [];
  dealsSnap.forEach((doc) => {
    const d = doc.data();
    const grp = (d.orgGroup || "").trim();
    if (!grp.includes("신한금융그룹")) return;
    if (droppedNames.has((d.orgName || "").trim())) return;
    const lastDate = lastActionByDeal[doc.id];
    let recency = "stale(이력없음)";
    let days = null;
    if (lastDate) {
      days = Math.floor((today - new Date(lastDate)) / 86400000);
      recency = days <= 7 ? "active7" : days <= 30 ? "followUp" : "stale";
    }
    result.push({
      orgName: d.orgName,
      targetProduct: d.targetProduct,
      probability: d.probability,
      lastActionDate: lastDate || null,
      daysSince: days,
      recency,
    });
  });

  result.sort((a, b) => (b.daysSince || 9999) - (a.daysSince || 9999));
  return NextResponse.json(result);
}
