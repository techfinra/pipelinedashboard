'use client';

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import "./dashboard.css";

function formatWon(n) {
  if (n === null || n === undefined) return "-";
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "억원";
  if (n >= 10000) return Math.round(n / 10000).toLocaleString() + "만원";
  return n.toLocaleString() + "원";
}

function probPillClass(p) {
  if (p === "완료" || p === "상") return "pill pill-" + p;
  if (p === "중") return "pill pill-중";
  if (p === "하") return "pill pill-하";
  return "pill pill-default";
}

function parseGoalMonth(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\s*월/);
  return m ? parseInt(m[1], 10) : null;
}

function isDone(deal) {
  return (deal.stage || "").includes("4") || deal.probability === "완료";
}

function classifyDeal(d, curMonth, nextMonth) {
  if (isDone(d)) return "done";
  const gm = parseGoalMonth(d.contractGoal);
  if (gm !== null) {
    if (gm === curMonth || gm === nextMonth) return "due";
    if (gm < curMonth) return "delayed";
  }
  return "progress";
}

function mondayOf(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function toYMD(d) {
  return d.toISOString().slice(0, 10);
}

const LOGO_DOMAINS = {
  "KB국민은행": "kbstar.com", "KB국민카드(KCB)": "kbcard.com", "KB국민카드(직영업)": "kbcard.com",
  "KB캐피탈": "kbcapital.com", "신한은행": "shinhan.com", "신한카드": "shinhancard.com",
  "신한캐피탈": "shinhancapital.com", "신한투자증권": "shinhansec.com", "신한지주": "shinhangroup.com",
  "하나은행(NICE)": "hanabank.com", "하나은행(직영업)": "hanabank.com", "하나카드": "hanacard.co.kr",
  "하나캐피탈": "hanacapital.co.kr", "우리은행": "wooribank.com", "우리카드": "wooricard.com",
  "NH농협은행": "nonghyup.com", "NH농협캐피탈": "nhcapital.co.kr", "IBK기업은행": "ibk.co.kr",
  "부산은행": "busanbank.co.kr", "제주은행": "jejubank.co.kr", "수협은행": "suhyup-bank.com",
  "카카오뱅크(NICE)": "kakaobank.com", "카카오뱅크(직영업)": "kakaobank.com",
  "토스뱅크(NICE)": "tossbank.com", "토스뱅크(직영업)": "tossbank.com",
  "비바리퍼블리카": "toss.im", "토스페이먼츠": "tosspayments.com",
  "케이뱅크(NICE)": "kbanknow.com", "케이뱅크(직영업)": "kbanknow.com",
  "KCB": "koreacb.com", "나이스평가정보": "nice.co.kr", "SGI서울보증": "sgic.co.kr",
  "신용보증기금": "kodit.co.kr", "더존": "douzone.com", "더존비즈온": "douzone.com",
  "전자신문사": "etnews.com", "한국수출입은행": "koreaexim.go.kr", "리드코프": "leadcorp.co.kr",
  "BNK캐피탈": "bnkcapital.co.kr",
};

function LogoBadge({ name }) {
  const domain = LOGO_DOMAINS[(name || "").trim()];
  const [broken, setBroken] = useState(false);
  if (domain && !broken) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt=""
        onError={() => setBroken(true)}
        className="w-[22px] h-[22px] rounded-[5px] mr-1.5 inline-block align-middle"
      />
    );
  }
  const initials = (name || "-").trim().slice(0, 2);
  return (
    <span className="inline-flex w-[22px] h-[22px] rounded-[5px] mr-1.5 bg-navy text-white text-[9px] font-bold items-center justify-center align-middle">
      {initials}
    </span>
  );
}

function Donut({ progress, due, delayed, done }) {
  const total = progress + due + delayed + done || 1;
  const pct = Math.round(((progress + done) / total) * 100);
  const segs = [
    { v: done + progress, color: "#16A34A" },
    { v: due, color: "#D97706" },
    { v: delayed, color: "#DC2626" },
  ];
  let acc = 0;
  const stops = segs.map((s) => {
    const start = (acc / total) * 360;
    acc += s.v;
    const end = (acc / total) * 360;
    return `${s.color} ${start}deg ${end}deg`;
  });
  return (
    <div
      className="w-16 h-16 rounded-full flex items-center justify-center shrink-0"
      style={{ background: `conic-gradient(${stops.join(",")})` }}
    >
      <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-xs font-extrabold text-navy">
        {pct}%
      </div>
    </div>
  );
}

const NAV_ITEMS = [
  { key: "dashboard", label: "대시보드", icon: "🏠" },
  { key: "pipeline", label: "파이프라인", icon: "📊" },
  { key: "orgs", label: "기관현황", icon: "🏢" },
  { key: "report", label: "리포트", icon: "📈" },
  { key: "settings", label: "설정", icon: "⚙️" },
];

export default function Dashboard() {
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState(null);
  const [deals, setDeals] = useState([]);
  const [allActivity, setAllActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState("전체");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "/";
        return;
      }
      setAuthChecked(true);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) setProfile(snap.data());
      } catch (e) {
        // 프로필 없어도 대시보드는 계속 진행
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    (async () => {
      try {
        const [dealsSnap, activitySnap] = await Promise.all([
          getDocs(collection(db, "deals")),
          getDocs(collection(db, "activityLog")),
        ]);
        setDeals(dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setAllActivity(activitySnap.docs.map((d) => d.data()));
      } catch (e) {
        setLoadError(String(e && e.message ? e.message : e));
      } finally {
        setLoading(false);
      }
    })();
  }, [authChecked]);

  const groups = useMemo(() => {
    const set = new Set(deals.map((d) => (d.orgGroup || "").replace(/\n/g, " ").trim()));
    return ["전체", ...Array.from(set).filter(Boolean)];
  }, [deals]);

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      const g = (d.orgGroup || "").replace(/\n/g, " ").trim();
      if (activeGroup !== "전체" && g !== activeGroup) return false;
      if (search && !(d.orgName || "").includes(search)) return false;
      return true;
    });
  }, [deals, activeGroup, search]);

  const kpis = useMemo(() => {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const nextMonth = curMonth === 12 ? 1 : curMonth + 1;

    const orgSet = new Set(deals.map((d) => (d.orgName || "").trim()).filter(Boolean));
    let inProgress = 0, dueSoon = 0, delayed = 0;

    deals.forEach((d) => {
      if (isDone(d)) return;
      inProgress++;
      const gm = parseGoalMonth(d.contractGoal);
      if (gm === null) return;
      if (gm === curMonth || gm === nextMonth) dueSoon++;
      else if (gm < curMonth) delayed++;
    });

    const mon = mondayOf(now);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    const monStr = toYMD(mon);
    const sunStr = toYMD(sun);
    const meetingsThisWeek = allActivity.filter((a) => a.date && a.date >= monStr && a.date <= sunStr).length;

    return { totalOrgs: orgSet.size, inProgress, dueSoon, delayed, meetingsThisWeek };
  }, [deals, allActivity]);

  const groupCards = useMemo(() => {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const nextMonth = curMonth === 12 ? 1 : curMonth + 1;

    const map = {};
    deals.forEach((d) => {
      const g = (d.orgGroup || "미분류").replace(/\n/g, " ").trim() || "미분류";
      if (!map[g]) map[g] = { name: g, orgs: new Set(), progress: 0, due: 0, delayed: 0, done: 0, orgReps: {} };
      map[g].orgs.add((d.orgName || "").trim());
      const cls = classifyDeal(d, curMonth, nextMonth);
      map[g][cls]++;
      const key = (d.orgName || "").trim();
      if (key) {
        const amt = d.expectedPerformance || 0;
        if (!map[g].orgReps[key] || amt > map[g].orgReps[key].amt) {
          map[g].orgReps[key] = { amt, deal: d };
        }
      }
    });

    return Object.values(map)
      .map((g) => ({
        ...g,
        orgCount: g.orgs.size,
        allOrgs: Object.entries(g.orgReps)
          .sort((a, b) => b[1].amt - a[1].amt)
          .map(([name, v]) => ({ name, deal: v.deal })),
      }))
      .sort((a, b) => b.orgCount - a.orgCount);
  }, [deals]);

  async function openDeal(deal) {
    setSelected(deal);
    setActivity([]);
    const q = query(collection(db, "activityLog"), where("dealId", "==", deal.id));
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => d.data());
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    setActivity(items);
  }

  if (!authChecked || loading) {
    return (
      <div className="p-10 font-sans">
        로딩 중...
        {loadError && <p className="text-red-600 mt-3">에러: {loadError}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F6F9] flex">
      <aside className="w-60 shrink-0 bg-gradient-to-b from-navy-deep to-navy text-white flex flex-col">
        <div className="px-6 py-5 flex items-center gap-2 border-b border-white/10">
          <span className="text-gold text-xl">◆</span>
          <div>
            <div className="font-bold text-sm leading-tight">TechFin Pipeline</div>
            <div className="text-[10px] text-white/50 leading-tight">Sales Growth Together</div>
          </div>
        </div>
        <nav className="flex-1 py-4">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.key}
              className={
                "mx-3 mb-1 px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 cursor-pointer " +
                (item.key === "dashboard" ? "bg-white/10 text-white font-semibold" : "text-white/60 hover:bg-white/5")
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </div>
          ))}
        </nav>
        <div className="p-4 text-[11px] text-white/40 border-t border-white/10">
          TechFin Ratings<br />세일즈추진팀
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="bg-white border-b border-[#E7EAF0] px-7 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold text-navy">금융기관 세일즈 파이프라인</h1>
            <p className="text-xs text-gray-500 mt-0.5">주요 금융기관과의 협업 현황을 한눈에 확인하세요.</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              className="text-xs border border-[#E7EAF0] rounded-lg px-3 py-2 w-56"
              placeholder="기관명·담당자로 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="text-[11px] bg-green-50 text-green-600 px-2.5 py-1.5 rounded-full font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> 실시간 업데이트
            </span>
            <div className="flex items-center gap-2 pl-3 border-l border-[#E7EAF0]">
              <div className="w-8 h-8 rounded-full bg-navy text-white text-xs flex items-center justify-center font-bold">
                {(profile?.name || "?").slice(0, 1)}
              </div>
              <div className="text-xs leading-tight">
                <div className="font-semibold text-navy">{profile?.name || "이름 미설정"}</div>
                <div className="text-gray-400">{profile?.division || ""}</div>
              </div>
            </div>
            <button onClick={() => signOut(auth)} className="text-[11px] text-gray-400 hover:text-navy ml-2">
              로그아웃
            </button>
          </div>
        </header>

        <div className="p-7">
          <div className="grid grid-cols-5 gap-3.5 mb-6">
            <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4">
              <div className="text-2xl font-extrabold text-navy">{kpis.totalOrgs}</div>
              <div className="text-xs text-gray-500 mt-1">전체 기관</div>
            </div>
            <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4">
              <div className="text-2xl font-extrabold text-green-600">{kpis.inProgress}</div>
              <div className="text-xs text-gray-500 mt-1">진행중</div>
            </div>
            <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4">
              <div className="text-2xl font-extrabold text-amber-500">{kpis.dueSoon}</div>
              <div className="text-xs text-gray-500 mt-1">마감임박</div>
            </div>
            <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4">
              <div className="text-2xl font-extrabold text-red-600">{kpis.delayed}</div>
              <div className="text-xs text-gray-500 mt-1">지연</div>
            </div>
            <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4">
              <div className="text-2xl font-extrabold text-navy">{kpis.meetingsThisWeek}</div>
              <div className="text-xs text-gray-500 mt-1">이번주 활동</div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-extrabold text-navy">산업군별 주요 기관</h2>
              <p className="text-xs text-gray-400 mt-0.5">각 카드를 선택하면 해당 그룹 딜만 아래 목록에서 확인할 수 있습니다.</p>
            </div>
            {activeGroup !== "전체" && (
              <button className="text-xs text-navy underline" onClick={() => setActiveGroup("전체")}>
                전체 보기
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 mb-7">
            {groupCards.map((g) => (
              <div
                key={g.name}
                onClick={() => setActiveGroup(activeGroup === g.name ? "전체" : g.name)}
                className={
                  "bg-white rounded-2xl border p-4 cursor-pointer transition " +
                  (activeGroup === g.name ? "border-navy ring-1 ring-navy" : "border-[#E7EAF0] hover:border-navy/40")
                }
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-sm text-navy">{g.name}</div>
                  <span className="text-gray-300">›</span>
                </div>
                <div className="text-[11px] text-gray-400 mb-3">총 {g.orgCount}개 기관</div>
                <div className="flex items-center gap-3 mb-3">
                  <Donut progress={g.progress} due={g.due} delayed={g.delayed} done={g.done} />
                  <div className="text-[11px] space-y-1">
                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> 진행 {g.progress + g.done}</div>
                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> 마감임박 {g.due}</div>
                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> 지연 {g.delayed}</div>
                  </div>
                </div>
                <div className="text-[10px] text-gray-400 mb-1.5">주요 기업 ({g.allOrgs.length})</div>
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {g.allOrgs.map((o) => (
                    <div
                      key={o.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeal(o.deal);
                      }}
                      className="flex items-center text-xs bg-[#F8FAFC] hover:bg-[#EEF2F7] rounded-lg px-2 py-1.5 cursor-pointer"
                    >
                      <LogoBadge name={o.name} />{o.name}
                    </div>
                  ))}
                  {g.allOrgs.length === 0 && <div className="text-[11px] text-gray-300">기관명 미상</div>}
                </div>
              </div>
            ))}
          </div>

          <table className="deals mt-2">
            <thead>
              <tr>
                <th>구분</th>
                <th>업체명</th>
                <th>타겟 제품</th>
                <th>RM / SO</th>
                <th>기대실적</th>
                <th>계약가능성</th>
                <th>진행단계</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} onClick={() => openDeal(d)}>
                  <td>{(d.orgGroup || "").replace(/\n/g, " ")}</td>
                  <td style={{ fontWeight: 700 }}><LogoBadge name={d.orgName} />{d.orgName}</td>
                  <td>{(d.targetProduct || "").replace(/\n/g, " ")}</td>
                  <td>{[d.rm, d.so].filter(Boolean).join(" / ")}</td>
                  <td>{formatWon(d.expectedPerformance)}</td>
                  <td><span className={probPillClass(d.probability)}>{d.probability || "-"}</span></td>
                  <td>{d.stage || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-navy-deep/30 z-30" onClick={() => setSelected(null)} />
          <div className="fixed top-0 right-0 w-[440px] max-w-full h-screen bg-white z-40 overflow-y-auto shadow-2xl">
            <div className="px-6 py-5 border-b border-[#E7EAF0] relative bg-gradient-to-br from-white to-[#F4F6F9]">
              <button
                className="absolute top-4 right-5 text-gray-400 hover:text-navy text-lg"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
              <div className="flex items-center gap-2 mb-1">
                <LogoBadge name={selected.orgName} />
                <h2 className="text-lg font-extrabold text-navy">{selected.orgName}</h2>
              </div>
              <div className="text-xs text-gray-500">
                {(selected.orgGroup || "").replace(/\n/g, " ")} · {(selected.targetProduct || "").replace(/\n/g, " ")}
              </div>
              <span className={probPillClass(selected.probability) + " mt-2 inline-block"}>
                {selected.probability || "가능성 미상"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-px bg-[#E7EAF0] border-b border-[#E7EAF0]">
              {[
                ["담당자", selected.contactPerson || "-"],
                ["RM / SO", [selected.rm, selected.so].filter(Boolean).join(" / ") || "-"],
                ["기대실적", formatWon(selected.expectedPerformance)],
                ["계약금액", formatWon(selected.contractAmount)],
                ["계약목표", selected.contractGoal || "-"],
                ["진행단계", selected.stage || "-"],
              ].map(([label, value]) => (
                <div key={label} className="bg-white px-4 py-3">
                  <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
                  <div className="text-xs font-semibold text-navy break-words">{value}</div>
                </div>
              ))}
            </div>

            <div className="px-6 py-3 border-b border-[#E7EAF0]">
              <div className="text-[10px] text-gray-400 mb-1">방문미팅</div>
              <div className="text-xs text-gray-700">{selected.visitMeetingRaw || "-"}</div>
            </div>

            <div className="px-6 py-4">
              <div className="text-xs font-extrabold text-navy mb-3">진행 이력 ({activity.length})</div>
              <div className="relative pl-4 space-y-4 border-l-2 border-[#E7EAF0]">
                {activity.map((a, i) => (
                  <div key={i} className="relative">
                    <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-navy border-2 border-white ring-1 ring-[#E7EAF0]" />
                    <div className="text-[11px] text-gray-400 mb-0.5">{a.date || "날짜 미상"}</div>
                    <div className="text-xs text-gray-700 leading-relaxed">{a.text}</div>
                  </div>
                ))}
                {activity.length === 0 && <div className="text-xs text-gray-300">이력이 없습니다.</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
