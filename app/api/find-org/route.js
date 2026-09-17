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
  const id = searchParams.get("id");
  const org = searchParams.get("org");
  const group = searchParams.get("group");
  if (!code || code !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const app = getAdminApp();
  const db = admin.firestore(app);
  const patch = {};
  if (org) patch.orgName = org;
  if (group) patch.orgGroup = group;
  await db.collection("deals").doc(id).update(patch);
  return NextResponse.json({ message: "완료", patch });
}
