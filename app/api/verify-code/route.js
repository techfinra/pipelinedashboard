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

const SHARED_UID = "pipeline-dashboard-shared-user";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const code = body.code;

  if (!code || code !== process.env.ACCESS_CODE) {
    return NextResponse.json({ error: "코드가 일치하지 않습니다." }, { status: 401 });
  }

  try {
    const app = getAdminApp();
    const token = await admin.auth(app).createCustomToken(SHARED_UID);
    return NextResponse.json({ token });
  } catch (e) {
    return NextResponse.json({ error: "토큰 발급 중 오류가 발생했습니다." }, { status: 500 });
  }
}
