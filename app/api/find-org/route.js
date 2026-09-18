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

  const counts = { 상: 0, 중: 0, 하: 0, 완료: 0, 드랍: 0, 미상: 0 };
  const unassessedList = [];
  dealsSnap.forEach((doc) => {
    const d = doc.data();
    const p = d.probability || "";
    if (counts[p] !== undefined) counts[p]++;
    else {
      counts["미상"]++;
      unassessedList.push({
        orgName: d.orgName,
        targetProduct: d.targetProduct,
        isDroppedCompany: droppedNames.has((d.orgName || "").trim()),
      });
    }
  });

  return NextResponse.json({ counts, unassessedCount: unassessedList.length, unassessedList });
}
