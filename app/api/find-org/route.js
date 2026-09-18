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

const CONTRACT_FILES = [
  { id: "p2MPqEe0xdxCY9n8Xqlb", url: "https://gwa.douzone.com/ecm/onechamber/?token=38aBae2B799183Bc214353987F8a5c6Ge382GF2eF5653DaGG5DD2DF68B1B2F4e" },
  { id: "ZA5AVtkO5oQN6FJCa9w5", url: "https://gwa.douzone.com/ecm/onechamber/?token=56BD2968DaGe4GeD1c69aD6F8D8125c1DG5244e1859cB41c5ae1e2F3ca522c65" },
  { id: "grXmKc5uqaQmY2rF4vYO", url: "https://gwa.douzone.com/ecm/onechamber/?token=GF3G3353cGFeFD39a9DB7eBGc6a25Gc88B8FG2896Fa1e6F395B2B837FF58B91c" },
  { id: "jV28xq6QqsbKQmEhfK27", url: "https://gwa.douzone.com/ecm/onechamber/?token=5e77G72ec88F48173936G9Dc1464a3cBB3DD78e7353D53Fe95a158cFF1454B85" },
  { id: "2cFGboNOheo9oo9tt28g", url: "https://gwa.douzone.com/ecm/onechamber/?token=a4345G2F87F4494ea6F318a31G57271F6aBa9363F4F82FDGG626a6FG225F2eGe" },
  { id: "48rVYPSkxhET4HOmwwz5", url: "https://gwa.douzone.com/ecm/onechamber/?token=57D4918594eBcc1G1Da4aG2c64ec6G31e861G77695Gca1G49F17e396eB4GB987" },
  { id: "DcHuU2aU0Qhlcja0DZkp", url: "https://gwa.douzone.com/ecm/onechamber/?token=4FGD2c6ea638F2B383e9cc94aae4FD54895285D9G3B1ceDGae1G9c6aa2eDF23F" },
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") || "").trim();
  const expected = (process.env.ACCESS_CODE || "").trim();
  if (!code || code !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);
    const results = [];
    for (const f of CONTRACT_FILES) {
      const ref = db.collection("deals").doc(f.id);
      const doc = await ref.get();
      if (!doc.exists) {
        results.push({ id: f.id, ok: false, reason: "not found" });
        continue;
      }
      const current = doc.data().relatedFiles || [];
      const updated = [...current, { label: "계약서", url: f.url }];
      await ref.update({ relatedFiles: updated });
      results.push({ id: f.id, orgName: doc.data().orgName, targetProduct: doc.data().targetProduct, ok: true });
    }
    return NextResponse.json({ message: "완료", results });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
