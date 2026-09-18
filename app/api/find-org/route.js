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
  const [dealsSnap, droppedSnap] = await Promise.all([
    db.collection("deals").get(),
    db.collection("droppedCompanies").get(),
  ]);
  const droppedNames = new Set(droppedSnap.docs.map((d) => d.id));
  const known = ["상", "중", "하", "완료", "드랍"];

  const batch = db.batch();
  let toDropped = 0, toHa = 0;
  dealsSnap.forEach((doc) => {
    const d = doc.data();
    const p = d.probability || "";
    if (known.includes(p)) return;
    const isDropped = droppedNames.has((d.orgName || "").trim());
    if (isDropped) {
      batch.update(doc.ref, { probability: "드랍" });
      toDropped++;
    } else {
      batch.update(doc.ref, { probability: "하" });
      toHa++;
    }
  });
  await batch.commit();

  return NextResponse.json({ message: "완료", toDropped, toHa });
}
