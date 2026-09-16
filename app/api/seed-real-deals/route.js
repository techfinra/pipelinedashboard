import { NextResponse } from "next/server";
import admin from "firebase-admin";
import deals from "../../../data/parsed-deals.json";

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

    const existing = await db.collection("deals").limit(1).get();
    if (!existing.empty) {
      return NextResponse.json({ message: "deals 컬렉션에 이미 데이터가 있어 건너뜀", seededDeals: 0, seededActivity: 0 });
    }

    let batch = db.batch();
    let opCount = 0;
    let dealCount = 0;
    let activityCount = 0;
    const commits = [];

    async function flushIfNeeded() {
      if (opCount >= 400) {
        commits.push(batch.commit());
        batch = db.batch();
        opCount = 0;
      }
    }

    for (const r of deals) {
      const dealRef = db.collection("deals").doc();
      batch.set(dealRef, {
        orgGroup: r.group || "",
        orgName: r.company || "",
        customerCount: r.customerCount || "",
        targetProduct: r.targetProduct || "",
        contactPerson: r.contactPerson || "",
        rm: r.rm || "",
        so: r.so || "",
        expectedPerformance: r.expectedPerformance,
        expectedPerformanceRaw: r.expectedPerfRaw || "",
        contractGoal: r.contractGoal || "",
        probability: r.probability || "",
        stage: r.stage || "",
        visitMeetingRaw: r.visitMeetingRaw || "",
        contractAmount: r.contractAmount,
        progressRaw: r.progressRaw || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      opCount++;
      dealCount++;
      await flushIfNeeded();

      for (const b of r.activityBullets || []) {
        const logRef = db.collection("activityLog").doc();
        batch.set(logRef, {
          dealId: dealRef.id,
          date: b.date,
          text: b.text,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        opCount++;
        activityCount++;
        await flushIfNeeded();
      }
    }
    commits.push(batch.commit());
    await Promise.all(commits);

    return NextResponse.json({ message: "시딩 완료", seededDeals: dealCount, seededActivity: activityCount });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
