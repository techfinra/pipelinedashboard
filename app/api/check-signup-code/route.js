import { NextResponse } from "next/server";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const code = (body.code || "").trim();
  const expected = (process.env.ACCESS_CODE || "").trim();

  if (!code || code !== expected) {
    return NextResponse.json({ error: "승인 코드가 올바르지 않습니다." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
