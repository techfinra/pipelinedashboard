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

const PRODUCT_MAP = {
  "CPS, 데이터": "Raw Data(CPS)",
  "Raw Data": "Raw Data",
  "Raw Data (매출채권보험 사고일 산정용)": "Raw Data(매출채권보험 사고일 산정용)",
  "Raw Data (월별매입매출)": "Raw Data(월별매입매출)",
  "Raw Data (월별매출매입)": "Raw Data(월별매입매출)",
  "Raw Data (월별재무제표)": "Raw Data(월별재무제표)",
  "Raw Data(CPS)": "Raw Data(CPS)",
  "Raw Data(부동산)": "Raw Data(부동산)",
  "Raw Data(분석용)": "Raw Data(분석용)",
  "Raw Data(생산적금융)": "Raw Data(생산적금융)",
  "Raw Data(월재무제표)": "Raw Data(월별재무제표)",
  "Raw Data(퇴직연금)": "Raw Data(퇴직연금)",
  "RawData": "Raw Data",
  "경영진단보고서": "경영진단보고서",
  "기업DB조회": "기업DB조회",
  "기업모니터링": "기업모니터링",
  "디지털공급망팩토링": "디지털공급망팩토링",
  "모니터링": "기업모니터링",
  "신용등급확인서(크래디뷰)": "크레디뷰",
  "크레디뷰": "크레디뷰",
  "크레디뷰 (경영진단보고서)": "크레디뷰",
  "크레디뷰(기업신용평가, AI경영진단보고서)": "크레디뷰",
  "크레디뷰(기업신용평가, 경영진단보고서": "크레디뷰",
  "크레디뷰(기업신용평가, 경영진단보고서)": "크레디뷰",
  "크레디뷰(기업신용평가, 경영진단보고서, 기업모니터링)": "크레디뷰",
  "패키지": "패키지",
  "패키지(경영진단보고서, 기업모니터링)": "패키지",
  "패키지(기업DB조회 , 기업모니터링)": "패키지",
  "패키지(기업DB조회, 기업모니터링)": "패키지",
  "패키지(기업DB조회, 기업모니터링) 데이터": "패키지",
  "패키지(기업신용평가, 경영진단보고서)": "패키지",
  "패키지(크레디뷰, 기업모니터링)": "패키지",
  "패키지1(기업DB조회, 기업모니터링) 패키지2 (기업신용평가, 경영진단보고서)": "패키지",
};

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
    let updated = 0;
    const unmatched = [];

    snap.forEach((docSnap) => {
      const raw = (docSnap.data().targetProduct || "").replace(/\n/g, " ").trim();
      if (!raw) return;
      const mapped = PRODUCT_MAP[raw];
      if (mapped) {
        if (mapped !== docSnap.data().targetProduct) {
          batch.update(docSnap.ref, { targetProduct: mapped });
          updated++;
        }
      } else {
        unmatched.push(raw);
      }
    });

    await batch.commit();
    return NextResponse.json({ message: "완료", updated, unmatched: [...new Set(unmatched)] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
