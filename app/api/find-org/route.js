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
  { id: "0aC1Ce4bwRRlfELVZhcL", orgName: "하나은행", dataChannel: "직영업" },
  { id: "3ipog6NpBNZ1WpSSwzar", orgName: "카카오뱅크", dataChannel: "직영업" },
  { id: "9k6SEntoujcW9rd5Q958", orgName: "롯데카드", dataChannel: "KCB" },
  { id: "BvNullkzT48o4FNiIYRN", orgName: "토스뱅크", dataChannel: "직영업" },
  { id: "HKyLzrfNMVBoFXTQ9suq", orgName: "하나은행", dataChannel: "NICE" },
  { id: "LnBP5SwogjFoHwp18Okh", orgName: "KB국민카드", dataChannel: "KCB" },
  { id: "TXxDNQ4Fg5RrLFwcUhpS", orgName: "케이뱅크", dataChannel: "NICE" },
  { id: "g3fvmKjTNontgWr9oOth", orgName: "KB국민카드", dataChannel: "직영업" },
  { id: "gQnxPbQkQFWTO1xlBIuF", orgName: "케이뱅크", dataChannel: "직영업" },
  { id: "n2qxfhkjdroxMDd0Itle", orgName: "NH카드", dataChannel: "NICE" },
  { id: "rPsCxolVyK9oEkQGiQfE", orgName: "토스뱅크", dataChannel: "NICE" },
  { id: "xPo40eYBnEzDvdj7aWxm", orgName: "카카오뱅크", dataChannel: "NICE" },
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
      batch.update(db.collection("deals").doc(u.id), { orgName: u.orgName, dataChannel: u.dataChannel });
    });
    await batch.commit();
    return NextResponse.json({ message: "완료", updated: UPDATES.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
