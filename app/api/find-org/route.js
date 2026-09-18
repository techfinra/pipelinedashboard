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
  const snap = await db.collection("deals").where("orgName", "==", "신한은행").get();
  const result = snap.docs.map((d) => ({
    id: d.id,
    targetProduct: d.data().targetProduct,
    relatedFiles: d.data().relatedFiles || [],
  }));
  return NextResponse.json(result);
}
