import { NextResponse } from "next/server";
import admin from "firebase-admin";
import relatedFiles from "../../../data/related-files.json";

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
  if (!code || code !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);

    const snap = await db.collection("deals").get();
    const byKey = new Map();
    snap.forEach((doc) => {
      const d = doc.data();
      const key = `${(d.orgName || "").trim()}|||${(d.targetProduct || "").trim()}`;
      byKey.set(key, doc.id);
    });

    let matched = 0, unmatched = 0;
    const unmatchedList = [];
    let batch = db.batch();
    let opCount = 0;
    const commits = [];

    for (const r of relatedFiles) {
      const key = `${r.company.trim()}|||${r.targetProduct.trim()}`;
      const docId = byKey.get(key);
      if (!docId) {
        unmatched++;
        unmatchedList.push(key);
        continue;
      }
      batch.update(db.collection("deals").doc(docId), { relatedFiles: r.relatedFiles });
      matched++;
      opCount++;
      if (opCount >= 400) {
        commits.push(batch.commit());
        batch = db.batch();
        opCount = 0;
      }
    }
    commits.push(batch.commit());
    await Promise.all(commits);

    return NextResponse.json({ message: "완료", matched, unmatched, unmatchedList });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
