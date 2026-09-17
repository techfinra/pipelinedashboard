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
  const org = searchParams.get("org");
  if (!code || code !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!org) return NextResponse.json({ error: "org 파라미터 필요" }, { status: 400 });

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);
    const snap = await db.collection("deals").where("orgName", "==", org).get();
    const batch = db.batch();
    const cleared = [];
    snap.forEach((doc) => {
      batch.update(doc.ref, { nextMeetingDate: "", nextMeetingNote: "" });
      cleared.push({ id: doc.id, targetProduct: doc.data().targetProduct });
    });
    await batch.commit();
    return NextResponse.json({ message: "완료", cleared });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
