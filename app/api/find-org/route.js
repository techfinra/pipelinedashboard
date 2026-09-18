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

const UPDATES = [
  { id: "p2MPqEe0xdxCY9n8Xqlb", org: "신한은행", product: "Raw Data(CPS)", contractStartDate: "2026-08-31", contractRenewalDate: "2027-08-31" },
  { id: "ZA5AVtkO5oQN6FJCa9w5", org: "신한은행", product: "Raw Data(월별매입매출)-부가세", contractStartDate: "2026-12-24", contractRenewalDate: "2027-12-24" },
  { id: "grXmKc5uqaQmY2rF4vYO", org: "신한은행", product: "Raw Data(월별재무제표)", contractStartDate: "2026-12-23", contractRenewalDate: "2027-12-23" },
  { id: "jV28xq6QqsbKQmEhfK27", org: "신한카드", product: "Raw Data(월별매입매출)-부가세", contractStartDate: "2026-09-30", contractRenewalDate: "2027-09-30" },
  { id: "2cFGboNOheo9oo9tt28g", org: "제주은행", product: "Raw Data(CPS)", contractStartDate: "2026-02-09", contractRenewalDate: "2027-02-09" },
  { id: "48rVYPSkxhET4HOmwwz5", org: "PACM", product: "패키지(기업모니터링 포함)", contractStartDate: "2026-08-01", contractRenewalDate: "2026-12-01" },
  { id: "DcHuU2aU0Qhlcja0DZkp", org: "신한캐피탈", product: "패키지(기업DB조회, 기업모니터링)", contractStartDate: "2026-07-01", contractRenewalDate: "2027-07-01" },
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") || "").trim();
  const expected = (process.env.ACCESS_CODE || "").trim();
  if (!code || code !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);
    const batch = db.batch();
    UPDATES.forEach((u) => {
      batch.update(db.collection("deals").doc(u.id), {
        contractStartDate: u.contractStartDate,
        contractRenewalDate: u.contractRenewalDate,
        contractRenewalInferredByAI: false,
      });
    });
    await batch.commit();
    return NextResponse.json({ message: "완료", updated: UPDATES.map((u) => ({ org: u.org, product: u.product })) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
