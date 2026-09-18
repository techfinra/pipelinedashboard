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

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);
    const snap = await db.collection("deals").get();
    const queries = ["신한은행", "신한카드", "제주은행", "PACM", "신한캐피탈"];
    const result = {};
    queries.forEach((q) => {
      result[q] = snap.docs
        .map((d) => ({ id: d.id, orgName: d.data().orgName, targetProduct: d.data().targetProduct, contractStartDate: d.data().contractStartDate, contractRenewalDate: d.data().contractRenewalDate }))
        .filter((d) => (d.orgName || "").includes(q));
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e && e.stack ? e.stack : e) }, { status: 500 });
  }
}
