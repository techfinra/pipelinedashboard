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

const TARGET_ORGS = ["롯데카드", "KB국민카드", "NH카드", "카카오뱅크", "케이뱅크", "하나은행", "토스뱅크"];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") || "").trim();
  const expected = (process.env.ACCESS_CODE || "").trim();
  if (!code || code !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const app = getAdminApp();
  const db = admin.firestore(app);
  const snap = await db.collection("deals").get();
  const result = snap.docs
    .map((d) => ({ id: d.id, orgName: d.data().orgName, targetProduct: d.data().targetProduct, orgGroup: d.data().orgGroup }))
    .filter((d) => TARGET_ORGS.some((base) => (d.orgName || "").includes(base)));
  return NextResponse.json(result);
}
