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

    const batch = db.batch();
    const changed = [];

    snap.forEach((docSnap) => {
      const files = docSnap.data().relatedFiles;
      if (!Array.isArray(files) || files.length === 0) return;
      const seen = new Set();
      const deduped = [];
      files.forEach((f) => {
        const key = (f.label || "") + "||" + (f.url || "");
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(f);
        }
      });
      if (deduped.length !== files.length) {
        batch.update(docSnap.ref, { relatedFiles: deduped });
        changed.push({
          id: docSnap.id,
          orgName: docSnap.data().orgName,
          targetProduct: docSnap.data().targetProduct,
          before: files.length,
          after: deduped.length,
        });
      }
    });

    if (changed.length > 0) await batch.commit();
    return NextResponse.json({ message: "완료", changedCount: changed.length, changed });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
