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

// 기존 딜 업데이트 대상 (orgName + targetProduct 키워드로 매칭)
const UPDATES = [
  { orgName: "신한은행", keyword: "기업모니터링", contractAmount: 3000000, contractGoal: "5월" },
  { orgName: "신한캐피탈", keyword: "패키지", contractAmount: 18000000, contractGoal: "6월" },
  { orgName: "SGI서울보증", keyword: "패키지", contractAmount: null, contractGoal: "7월" },
  { orgName: "제주은행", keyword: "CPS", contractAmount: 30000000, contractGoal: "2월" },
  { orgName: "중진공창업지원처", keyword: "기업DB조회", contractAmount: 5000000, contractGoal: "7월" },
  { orgName: "PACM", keyword: "패키지", contractAmount: 6000000, contractGoal: "8월" },
  { orgName: "더존비즈온", keyword: "채권추심팀", contractAmount: 120000000, contractGoal: "8월", secondKeyword: "패키지" },
  { orgName: "신한은행", keyword: "월별매입매출", contractAmount: 310000000 },
  { orgName: "신한은행", keyword: "월재무제표", contractAmount: 270000000 },
  { orgName: "신한은행", keyword: "CPS", contractAmount: 30000000, disambiguateNotChae: true },
  { orgName: "신한카드", keyword: "월별매입매출", contractAmount: 200000000 },
  { orgName: "한국수출입은행", keyword: "팩토링", contractAmount: 59000000 },
];

// 신규 생성 대상 (원본 문서에 없던 딜)
const NEW_DEALS = [
  { orgGroup: "정책지원", orgName: "중진공창업지원처", targetProduct: "팩토링", rm: "이창희", so: "육태우", contractGoal: "26년", contractAmount: 77000000 },
  { orgGroup: "정책지원", orgName: "중진공창업지원처", targetProduct: "네트워크론", rm: "이창희", so: "육태우", contractGoal: "26년", contractAmount: 312000000 },
  { orgGroup: "신한금융그룹", orgName: "신한은행", targetProduct: "팩토링", rm: "이창희", so: "", contractGoal: "26년", contractAmount: 1000000 },
];

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
    const allDeals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let updated = 0;
    const notFound = [];
    const batch1 = db.batch();

    for (const u of UPDATES) {
      const candidates = allDeals.filter((d) => {
        const org = (d.orgName || "").trim();
        const prod = (d.targetProduct || "");
        if (org !== u.orgName) return false;
        if (!prod.includes(u.keyword)) return false;
        if (u.secondKeyword && !prod.includes(u.secondKeyword)) return false;
        if (u.disambiguateNotChae && org !== "신한은행") return false;
        return true;
      });
      if (candidates.length !== 1) {
        notFound.push({ ...u, matchCount: candidates.length });
        continue;
      }
      const patch = { probability: "완료", stage: "4단계", updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (u.contractAmount !== null && u.contractAmount !== undefined) patch.contractAmount = u.contractAmount;
      if (u.contractGoal) patch.contractGoal = u.contractGoal;
      batch1.update(db.collection("deals").doc(candidates[0].id), patch);
      updated++;
    }
    await batch1.commit();

    let created = 0;
    const batch2 = db.batch();
    for (const nd of NEW_DEALS) {
      const ref = db.collection("deals").doc();
      batch2.set(ref, {
        orgGroup: nd.orgGroup,
        orgName: nd.orgName,
        customerCount: "",
        targetProduct: nd.targetProduct,
        contactPerson: "",
        rm: nd.rm,
        so: nd.so,
        expectedPerformance: nd.contractAmount,
        expectedPerformanceRaw: "",
        contractGoal: nd.contractGoal,
        probability: "완료",
        stage: "4단계",
        visitMeetingRaw: "",
        contractAmount: nd.contractAmount,
        progressRaw: "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      created++;
    }
    await batch2.commit();

    return NextResponse.json({ message: "완료", updated, created, notFound });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
