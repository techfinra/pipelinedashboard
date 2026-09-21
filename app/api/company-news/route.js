import { NextResponse } from "next/server";

function decodeXmlEntities(s) {
  return (s || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// 구글 뉴스 RSS 검색 — 별도 API 키 없이 실제 뉴스 헤드라인을 가져온다.
async function fetchCompanyNews(orgName) {
  const query = encodeURIComponent(`${orgName} when:30d`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TechFinRatingsBot/1.0)" },
    // 뉴스 조회가 느려져도 화면 전체가 막히지 않도록 타임아웃을 짧게 둔다.
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
  return items
    .map((m) => {
      const block = m[1];
      const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
      const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
      const rawSource = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "";
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
      return {
        title: decodeXmlEntities(rawTitle),
        source: decodeXmlEntities(rawSource),
        date: pubDate ? new Date(pubDate).toISOString() : null,
        link: decodeXmlEntities(link),
      };
    })
    .filter((n) => n.title && n.link);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const orgName = (searchParams.get("orgName") || "").trim();

  if (!orgName) {
    return NextResponse.json({ error: "기업명이 필요합니다." }, { status: 400 });
  }

  try {
    const news = await fetchCompanyNews(orgName);
    return NextResponse.json({ news });
  } catch (e) {
    // 뉴스 조회 실패는 화면 전체 오류로 취급하지 않고 빈 목록으로 응답한다.
    return NextResponse.json({ news: [], error: e.message || String(e) });
  }
}
