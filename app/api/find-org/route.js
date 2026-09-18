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
  const q = searchParams.get("q") || "";
  if (!code || code !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const app = getAdminApp();
  const db = admin.firestore(app);
  const [dealsSnap, droppedSnap] = await Promise.all([
    db.collection("deals").get(),
    db.collection("droppedCompanies").get(),
  ]);
  const droppedNames = droppedSnap.docs.map((d) => d.id);
  const matches = dealsSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        orgName: data.orgName,
        orgGroup: data.orgGroup,
        targetProduct: data.targetProduct,
        nextMeetingDate: data.nextMeetingDate,
        nextMeetingDateType: typeof data.nextMeetingDate,
        nextMeetingNote: data.nextMeetingNote,
        stage: data.stage,
        probability: data.probability,
        isDropped: droppedNames.includes((data.orgName || "").trim()),
      };
    })
    .filter((d) => (d.orgName || "").includes(q));
  return NextResponse.json({ matches, droppedNames });
}
