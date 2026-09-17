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
    const dealsSnap = await db.collection("deals").where("orgName", "==", org).get();
    const dealIds = dealsSnap.docs.map((d) => d.id);
    if (dealIds.length === 0) return NextResponse.json({ message: "해당 업체 딜 없음" });

    const logsSnap = await db.collection("activityLog").where("dealId", "in", dealIds.slice(0, 10)).get();
    const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    logs.sort((a, b) => {
      const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bt - at;
    });
    if (logs.length === 0) return NextResponse.json({ message: "이력 없음" });

    const target = logs[0];
    await db.collection("activityLog").doc(target.id).delete();
    return NextResponse.json({ message: "삭제 완료", deleted: { date: target.date, text: target.text, dealId: target.dealId } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
