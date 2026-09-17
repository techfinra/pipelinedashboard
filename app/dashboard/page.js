'use client';

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, query, where, doc, getDoc, updateDoc, addDoc, arrayUnion, arrayRemove, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import "./dashboard.css";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  Search, Bell, ChevronDown, Star, X, User, Users, TrendingUp, Wallet,
  CalendarClock, Flag, FileText, LayoutGrid, List, Landmark, CreditCard,
  Building2, Handshake, Cpu, ShieldCheck, Truck, PartyPopper, Factory,
  Percent, Layers, ClipboardList, PlayCircle, Clock3, AlertTriangle,
  LayoutDashboard, Workflow, BarChart3, Settings, PanelLeftClose, PanelLeftOpen,
  Sun, Moon, Sparkles,
} from "lucide-react";

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

function parseAmountKR(text) {
  if (!text) return null;
  const t = text.trim();
  if (t === "" || t === "-") return null;
  if (t.includes("무상")) return 0;
  const plain = t.replace(/,/g, "");
  if (/^\d+원?$/.test(plain)) return parseInt(plain.replace("원", ""), 10);
  let total = 0, matched = false;
  const re = /([\d.]+)\s*(억|천만|백만|만)/g;
  let m;
  while ((m = re.exec(t))) {
    matched = true;
    const n = parseFloat(m[1]);
    const mult = { "억": 1e8, "천만": 1e7, "백만": 1e6, "만": 1e4 }[m[2]];
    total += n * mult;
  }
  return matched ? Math.round(total) : null;
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
  "BNK캐피탈": "bnkcapital.co.kr", "중진공": "kosmes.or.kr",
};

function LogoBadge({ name }) {
  const domain = LOGO_DOMAINS[(name || "").trim()];
  const [broken, setBroken] = useState(false);
  if (domain && !broken) {
    return (
      <img
        src={`https://img.logo.dev/${domain}?token=pk_dj9Yvu0VRguqwmAbY-tGzg&size=64&format=png&fallback=404`}
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

function GroupDonut({ active7, followUp, stale }) {
  const total = active7 + followUp + stale || 0;
  const pct = total > 0 ? Math.round((active7 / total) * 100) : 0;
  const raw = [
    { name: "활발 진행", value: active7, color: "#16A34A" },
    { name: "후속 필요", value: followUp, color: "#2563EB" },
    { name: "장기 정체", value: stale, color: "#DC2626" },
  ];
  const data = total > 0 ? raw.filter((d) => d.value > 0) : [{ name: "없음", value: 1, color: "#E5E7EB" }];
  return (
    <div className="relative w-[132px] h-[132px] shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            paddingAngle={data.length > 1 ? 3 : 0}
            cornerRadius={7}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-extrabold text-navy dark:text-gray-100 leading-none">{pct}%</span>
        <span className="text-[9px] text-gray-400 mt-1">활발 진행률</span>
      </div>
    </div>
  );
}

function DonutLegendRow({ color, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        {label}
      </span>
      <span className="text-base font-extrabold text-navy dark:text-gray-100">{value}</span>
    </div>
  );
}

const GROUP_MAP = {
  "신한금융그룹\n+주주": "신한금융그룹",
  "5대 금융지주 은행\n+IBK": "은행",
  "지방은행\n특수은행": "은행",
  "인터넷\n은행": "은행",
  "저축은행": "은행",
  "코피티션": "코피티션",
  "카드": "카드",
  "캐피탈": "캐피탈",
  "핀테크": "핀테크",
  "정책지원": "정책지원",
  "협회": "협회",
  "VC\n(대형GP)": "VC",
  "VC\n(중견·소)": "VC",
  "VC\n(중견소)": "VC",
  "VC\n(대기업)": "VC",
  "일반기업": "일반기업",
  "금융": "행사(오프라인)",
  "VC\n(지원기관)": "행사(오프라인)",
  "일반\n행사": "행사(오프라인)",
  "홍보": "행사(오프라인)",
  "팩토링": "팩토링",
  "렌탈\n·리스": "렌탈·리스",
};

const GROUP_ORDER = [
  "신한금융그룹", "은행", "코피티션", "카드", "캐피탈", "핀테크",
  "정책지원", "협회", "VC", "일반기업", "행사(오프라인)", "팩토링", "렌탈·리스",
];

function mapGroupName(raw) {
  const key = (raw || "").trim();
  return GROUP_MAP[key] || (key === "" ? "미분류" : key);
}

function EditableLine({ label, meta, value, editing, editable, multiline, highlight, icon: Icon, editValue, setEditValue, onEdit, onCancel, onSave, saving }) {
  return (
    <div className={highlight ? "bg-orange-50 border border-orange-100 rounded-lg px-2.5 py-2" : ""}>
      <div className="flex items-center justify-between">
        <span className="text-gray-400 flex items-center gap-1">{Icon && <Icon className="w-3 h-3" />}{label}{meta ? ` (${meta})` : ""}</span>
        {editable && !editing && (
          <button className="text-navy dark:text-gray-100 underline" onClick={onEdit}>수정</button>
        )}
      </div>
      {!editing ? (
        <div className="text-gray-700 mt-0.5 whitespace-pre-wrap">{value || "미입력"}</div>
      ) : (
        <div className="mt-1 space-y-1.5">
          {multiline ? (
            <textarea
              className="w-full border border-[#E7EAF0] rounded-lg px-2 py-1.5 text-xs"
              rows={3}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
          ) : (
            <input
              className="w-full border border-[#E7EAF0] rounded-lg px-2 py-1.5 text-xs"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
          )}
          <div className="flex gap-2 justify-end">
            <button className="text-gray-400" onClick={onCancel}>취소</button>
            <button className="bg-navy text-white px-2.5 py-1 rounded-lg" onClick={onSave} disabled={saving}>
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const GROUP_ICONS = {
  "신한금융그룹": Landmark, "은행": Landmark, "코피티션": Handshake, "카드": CreditCard,
  "캐피탈": Wallet, "핀테크": Cpu, "정책지원": ShieldCheck, "협회": Users,
  "VC": TrendingUp, "일반기업": Factory, "행사(오프라인)": PartyPopper,
  "팩토링": FileText, "렌탈·리스": Truck, "미분류": Building2,
};
function GroupIcon({ name, className }) {
  const Icon = GROUP_ICONS[name] || Building2;
  return <Icon className={className} strokeWidth={2} />;
}

function ddayFromGoal(contractGoal) {
  const month = parseGoalMonth(contractGoal);
  if (!month) return null;
  const now = new Date();
  const target = new Date(now.getFullYear(), month, 0);
  const diff = Math.ceil((target - now) / 86400000);
  return { diff, label: target.toISOString().slice(0, 10) };
}

const ORG_ALIASES = {
  "더존": "더존비즈온",
  "더존>전략투자Unit": "더존비즈온",
  "더존비즈온\n(채권추심팀)": "더존비즈온",
  "더존비즈온": "더존비즈온",
  "Plan.H": "Plan.H",
  "Plan.H벤처스": "Plan.H",
};
function canonicalOrg(name) {
  const key = (name || "").trim();
  return ORG_ALIASES[key] || key;
}

function classifyTargetProduct(text) {
  const t = (text || "").trim();
  if (!t) return "기타";
  if (t.includes("패키지")) return "플랫폼";
  if (/raw\s*data/i.test(t)) return "Raw Data";
  if (/\bCPS\b/i.test(t)) return "Raw Data";
  if (t.includes("기업DB조회") || t.includes("기업모니터링") || t === "모니터링") return "플랫폼";
  if (t.includes("크레디뷰") || t.includes("경영진단보고서") || t.includes("기업신용평가")) return "플랫폼";
  return "기타";
}

const KPI_DEFS = [
  { key: "active7", color: "text-green-600", bg: "bg-green-50", ring: "ring-green-500", icon: PlayCircle, label: "활발 진행", meta: "최근 7일" },
  { key: "followUp", color: "text-blue-600", bg: "bg-blue-50", ring: "ring-blue-500", icon: Clock3, label: "후속 필요", meta: "8~30일" },
  { key: "stale", color: "text-red-600", bg: "bg-red-50", ring: "ring-red-500", icon: AlertTriangle, label: "장기 정체", meta: "30일 초과" },
  { key: "actionDue", color: "text-orange-500", bg: "bg-orange-50", ring: "ring-orange-400", icon: Flag, label: "액션 도래", meta: "7일 이내" },
  { key: "actionPlanned", color: "text-purple-600", bg: "bg-purple-50", ring: "ring-purple-500", icon: CalendarClock, label: "액션 예정", meta: "8일 이후" },
];

const RECENCY_LABEL = {
  active7: ["활발 진행", "text-green-600 bg-green-50"],
  followUp: ["후속 필요", "text-blue-600 bg-blue-50"],
  stale: ["장기 정체", "text-red-600 bg-red-50"],
};

const NAV_ITEMS = [
  { key: "dashboard", label: "대시보드", icon: LayoutDashboard },
  { key: "orgs", label: "기관현황", icon: Building2 },
  { key: "report", label: "리포트", icon: BarChart3 },
  { key: "settings", label: "설정", icon: Settings },
];

export default function Dashboard() {
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModalKey, setProfileModalKey] = useState(null);
  const [reportModal, setReportModal] = useState(null);
  const [deals, setDeals] = useState([]);
  const [allActivity, setAllActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [groupViewMode, setGroupViewMode] = useState("card");
  const [listFilterGroup, setListFilterGroup] = useState("전체");
  const [listFilterRecency, setListFilterRecency] = useState("전체");
  const [darkMode, setDarkMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState("전체");
  const [activeKpi, setActiveKpi] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loadError, setLoadError] = useState("");

  const [editMode, setEditMode] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editMeetingDate, setEditMeetingDate] = useState("");
  const [editMeetingNote, setEditMeetingNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [showNewDeal, setShowNewDeal] = useState(false);
  const [newDeal, setNewDeal] = useState({
    orgGroup: GROUP_ORDER[0],
    orgName: "",
    targetProduct: "",
    contactPerson: "",
    rm: "",
    so: "",
    expectedPerformanceRaw: "",
    contractGoal: "",
    probability: "중",
    stage: "1단계",
    visitMeetingRaw: "",
    firstActionDate: "",
    firstActionText: "",
  });
  const [creatingDeal, setCreatingDeal] = useState(false);

  const [nlText, setNlText] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlResult, setNlResult] = useState(null);
  const [nlOverrideDealId, setNlOverrideDealId] = useState("");
  const [nlDate, setNlDate] = useState("");
  const [nlActionText, setNlActionText] = useState("");
  const [nlSaving, setNlSaving] = useState(false);
  const [nlError, setNlError] = useState("");
  const [detailTab, setDetailTab] = useState("info");
  const [notifOpen, setNotifOpen] = useState(false);
  const [kpiModalKey, setKpiModalKey] = useState(null);
  const [selectedOrgName, setSelectedOrgName] = useState(null);
  const [selectedOrgCategory, setSelectedOrgCategory] = useState("Raw Data");
  const [panelOrigin, setPanelOrigin] = useState(null);
  const [activeProductCat, setActiveProductCat] = useState(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("pd-theme");
    const isDark = saved === "dark";
    setDarkMode(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  function toggleDarkMode() {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      window.localStorage.setItem("pd-theme", next ? "dark" : "light");
      return next;
    });
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "/";
        return;
      }
      setAuthChecked(true);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          setProfile(snap.data());
          setFavorites(snap.data().favorites || []);
        }
      } catch (e) {}
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

  useEffect(() => {
    if (!selected) return;
    setEditingField(null);
    setEditMeetingDate(selected.nextMeetingDate || "");
    setEditMeetingNote(selected.nextMeetingNote || "");
    setActiveProductCat(classifyTargetProduct(selected.targetProduct));
  }, [selected]);

  const lastActionByDeal = useMemo(() => {
    const map = {};
    allActivity.forEach((a) => {
      if (!a.date || !a.dealId) return;
      if (!map[a.dealId] || a.date > map[a.dealId]) map[a.dealId] = a.date;
    });
    return map;
  }, [allActivity]);

  const dealKpiCat = useMemo(() => {
    const now = new Date();
    const map = {};
    deals.forEach((d) => {
      const lastDate = lastActionByDeal[d.id];
      let recency;
      if (lastDate) {
        const diffDays = Math.floor((now - new Date(lastDate)) / 86400000);
        recency = diffDays <= 7 ? "active7" : diffDays <= 30 ? "followUp" : "stale";
      } else {
        recency = "stale";
      }
      let future = null;
      let futureReason = null;
      let futureDate = null;
      if (d.nextMeetingDate) {
        const diffFuture = Math.floor((new Date(d.nextMeetingDate) - now) / 86400000);
        if (diffFuture >= 0 && diffFuture <= 7) { future = "actionDue"; futureReason = "meeting"; futureDate = d.nextMeetingDate; }
        else if (diffFuture > 7) { future = "actionPlanned"; futureReason = "meeting"; futureDate = d.nextMeetingDate; }
      }
      if (d.contractRenewalDate) {
        const diffRenewal = Math.floor((new Date(d.contractRenewalDate) - now) / 86400000);
        let renewalCat = null;
        if (diffRenewal >= 0 && diffRenewal <= 30) renewalCat = "actionDue";
        else if (diffRenewal > 30 && diffRenewal <= 60) renewalCat = "actionPlanned";
        if (renewalCat) {
          // 갱신 임박이 더 급하면(actionDue) 우선, 같은 등급이면 더 이른 날짜 우선
          if (!future || (renewalCat === "actionDue" && future !== "actionDue") || (renewalCat === future && diffRenewal < Math.floor((new Date(futureDate) - now) / 86400000))) {
            future = renewalCat;
            futureReason = "renewal";
            futureDate = d.contractRenewalDate;
          }
        }
      }
      map[d.id] = { recency, future, futureReason, futureDate };
    });
    return map;
  }, [deals, lastActionByDeal]);

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      const g = mapGroupName(d.orgGroup);
      if (activeGroup !== "전체" && g !== activeGroup) return false;
      if (search && !(d.orgName || "").includes(search)) return false;
      if (activeKpi) {
        const cat = dealKpiCat[d.id] || {};
        if (cat.recency !== activeKpi && cat.future !== activeKpi) return false;
      }
      return true;
    });
  }, [deals, activeGroup, search, activeKpi, dealKpiCat]);

  const kpis = useMemo(() => {
    let active7 = 0, followUp = 0, stale = 0, actionDue = 0, actionPlanned = 0;
    Object.values(dealKpiCat).forEach((c) => {
      if (c.recency === "active7") active7++;
      else if (c.recency === "followUp") followUp++;
      else stale++;
      if (c.future === "actionDue") actionDue++;
      else if (c.future === "actionPlanned") actionPlanned++;
    });
    return { active7, followUp, stale, actionDue, actionPlanned };
  }, [dealKpiCat]);

  const groupCards = useMemo(() => {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const nextMonth = curMonth === 12 ? 1 : curMonth + 1;
    const map = {};
    deals.forEach((d) => {
      const g = mapGroupName(d.orgGroup);
      if (!map[g]) map[g] = { name: g, orgs: new Set(), progress: 0, due: 0, delayed: 0, done: 0, active7: 0, followUp: 0, stale: 0, orgReps: {}, expected: 0, contract: 0 };
      map[g].orgs.add((d.orgName || "").trim());
      const cls = classifyDeal(d, curMonth, nextMonth);
      map[g][cls]++;
      const recency = dealKpiCat[d.id]?.recency;
      if (recency) map[g][recency]++;
      map[g].expected += d.expectedPerformance || 0;
      map[g].contract += d.contractAmount || 0;
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
        allOrgs: Object.entries(g.orgReps).sort((a, b) => b[1].amt - a[1].amt).map(([name, v]) => ({ name, deal: v.deal })),
      }))
      .sort((a, b) => {
        const ia = GROUP_ORDER.indexOf(a.name);
        const ib = GROUP_ORDER.indexOf(b.name);
        if (ia === -1 && ib === -1) return b.orgCount - a.orgCount;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
  }, [deals, dealKpiCat]);

  const probDist = useMemo(() => {
    const counts = { 상: 0, 중: 0, 하: 0, 완료: 0, 미상: 0 };
    deals.forEach((d) => {
      const p = d.probability;
      if (p && counts[p] !== undefined) counts[p]++;
      else counts["미상"]++;
    });
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [deals]);

  const monthlyActivity = useMemo(() => {
    const map = {};
    allActivity.forEach((a) => {
      if (!a.date) return;
      const ym = a.date.slice(0, 7);
      map[ym] = (map[ym] || 0) + 1;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, count]) => ({ month, count }));
  }, [allActivity]);

  async function dismissAiInsight(dealId, actionText) {
    try {
      await updateDoc(doc(db, "deals", dealId), { aiFlag: false, aiDismissedForAction: actionText || null });
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, aiFlag: false, aiDismissedForAction: actionText || null } : d)));
    } catch (e) {
      alert("실패: " + (e.message || e));
    }
  }

  async function toggleFavorite(orgName) {
    if (!auth.currentUser) return;
    const isFav = favorites.includes(orgName);
    try {
      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        favorites: isFav ? arrayRemove(orgName) : arrayUnion(orgName),
      });
      setFavorites((prev) => (isFav ? prev.filter((n) => n !== orgName) : [...prev, orgName]));
    } catch (e) {
      alert("저장 실패: " + (e.message || e));
    }
  }

  const myActionNeededDeals = useMemo(() => {
    if (!profile?.name) return [];
    return deals
      .filter((d) => (d.rm === profile.name || d.so === profile.name))
      .filter((d) => ["actionDue", "actionPlanned"].includes(dealKpiCat[d.id]?.future))
      .sort((a, b) => (lastActionByDeal[b.id] || "").localeCompare(lastActionByDeal[a.id] || ""));
  }, [deals, dealKpiCat, profile, lastActionByDeal]);

  const companyRows = useMemo(() => {
    const map = {};
    deals.forEach((d) => {
      const name = (d.orgName || "").trim();
      if (!name) return;
      if (!map[name]) map[name] = { name, group: mapGroupName(d.orgGroup), deals: [], active7: 0, followUp: 0, stale: 0 };
      map[name].deals.push(d);
      const recency = dealKpiCat[d.id]?.recency;
      if (recency) map[name][recency]++;
    });
    return Object.values(map)
      .map((o) => {
        const counts = { "Raw Data": 0, "플랫폼": 0, "기타": 0 };
        o.deals.forEach((d) => counts[classifyTargetProduct(d.targetProduct)]++);
        const totalExpected = o.deals.reduce((a, d) => a + (d.expectedPerformance || 0), 0);
        const dominant = o.stale > 0 ? "stale" : o.followUp > 0 ? "followUp" : "active7";
        return { ...o, counts, totalCount: o.deals.length, totalExpected, dominant };
      })
      .sort((a, b) => b.totalCount - a.totalCount);
  }, [deals, dealKpiCat]);

  const allOrgFlat = useMemo(() => {
    const rows = [];
    groupCards.forEach((g) => {
      g.allOrgs.forEach((o) => rows.push({ ...o, groupName: g.name }));
    });
    return rows;
  }, [groupCards]);

  const searchMatches = useMemo(() => {
    if (!search.trim()) return [];
    return companyRows.filter((o) => o.name.includes(search.trim())).slice(0, 8);
  }, [search, companyRows]);

  const aiFlaggedDeals = useMemo(() => {
    if (!profile?.name) return [];
    return deals.filter((d) => d.aiFlag && (d.rm === profile.name || d.so === profile.name));
  }, [deals, profile]);

  const actionDueDeals = useMemo(() => {
    return deals
      .filter((d) => dealKpiCat[d.id]?.future === "actionDue")
      .sort((a, b) => (a.nextMeetingDate || "").localeCompare(b.nextMeetingDate || ""));
  }, [deals, dealKpiCat]);

  const orgRows = useMemo(() => {
    const map = {};
    deals.forEach((d) => {
      const key = (d.orgName || "").trim();
      if (!key) return;
      if (!map[key]) map[key] = { name: key, group: mapGroupName(d.orgGroup), count: 0, expected: 0, contract: 0, bestDeal: d };
      map[key].count++;
      map[key].expected += d.expectedPerformance || 0;
      map[key].contract += d.contractAmount || 0;
      if ((d.expectedPerformance || 0) > (map[key].bestDeal.expectedPerformance || 0)) map[key].bestDeal = d;
    });
    return Object.values(map)
      .filter((o) => !search || o.name.includes(search))
      .sort((a, b) => b.expected - a.expected);
  }, [deals, search]);

  async function openDeal(deal, origin) {
    setPanelOrigin(origin || null);
    if (origin) setSelectedOrgName(null);
    setSelected(deal);
    setDetailTab("info");
    setActivity([]);
    const q = query(collection(db, "activityLog"), where("dealId", "==", deal.id));
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    setActivity(items);
  }

  function startEdit(field, initialValue) {
    setEditingField(field);
    setEditValue(initialValue || "");
  }
  function cancelEdit() {
    setEditingField(null);
  }

  async function saveDealField(patch) {
    setSaving(true);
    try {
      await updateDoc(doc(db, "deals", selected.id), { ...patch, updatedAt: serverTimestamp() });
      const merged = { ...selected, ...patch, updatedAt: new Date() };
      setSelected(merged);
      setDeals((prev) => prev.map((d) => (d.id === selected.id ? merged : d)));
      setEditingField(null);
    } catch (e) {
      alert("저장 실패: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function saveActivityText(activityId) {
    setSaving(true);
    try {
      await updateDoc(doc(db, "activityLog", activityId), { text: editValue });
      setActivity((prev) => prev.map((a) => (a.id === activityId ? { ...a, text: editValue } : a)));
      setEditingField(null);
    } catch (e) {
      alert("저장 실패: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function saveMeeting() {
    await saveDealField({ nextMeetingDate: editMeetingDate, nextMeetingNote: editMeetingNote });
    setEditingField(null);
  }

  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);

  async function handleAddLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
    const updated = [...(selected.relatedFiles || []), { label: newLinkLabel.trim(), url: newLinkUrl.trim() }];
    await saveDealField({ relatedFiles: updated });
    setNewLinkLabel("");
    setNewLinkUrl("");
    setAddingLink(false);
  }

  async function handleCreateDeal() {
    if (!newDeal.orgName.trim()) {
      alert("업체명을 입력해주세요.");
      return;
    }
    setCreatingDeal(true);
    try {
      const dealPayload = {
        orgGroup: newDeal.orgGroup,
        orgName: newDeal.orgName.trim(),
        targetProduct: newDeal.targetProduct.trim(),
        contactPerson: newDeal.contactPerson.trim(),
        rm: newDeal.rm.trim(),
        so: newDeal.so.trim(),
        expectedPerformance: parseAmountKR(newDeal.expectedPerformanceRaw),
        expectedPerformanceRaw: newDeal.expectedPerformanceRaw.trim(),
        contractGoal: newDeal.contractGoal.trim(),
        probability: newDeal.probability,
        stage: newDeal.stage,
        visitMeetingRaw: newDeal.visitMeetingRaw.trim(),
        contractAmount: null,
        nextAction: "",
        nextMeetingDate: "",
        nextMeetingNote: "",
        memo: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "deals"), dealPayload);

      if (newDeal.firstActionText.trim()) {
        await addDoc(collection(db, "activityLog"), {
          dealId: ref.id,
          date: newDeal.firstActionDate || null,
          text: newDeal.firstActionText.trim(),
          createdAt: serverTimestamp(),
        });
      }

      setDeals((prev) => [...prev, { id: ref.id, ...dealPayload }]);
      if (newDeal.firstActionText.trim()) {
        setAllActivity((prev) => [...prev, { dealId: ref.id, date: newDeal.firstActionDate || null, text: newDeal.firstActionText.trim() }]);
      }
      setShowNewDeal(false);
      setNewDeal({
        orgGroup: GROUP_ORDER[0], orgName: "", targetProduct: "", contactPerson: "", rm: "", so: "",
        expectedPerformanceRaw: "", contractGoal: "", probability: "중", stage: "1단계",
        visitMeetingRaw: "", firstActionDate: "", firstActionText: "",
      });
    } catch (e) {
      alert("등록 실패: " + (e.message || e));
    } finally {
      setCreatingDeal(false);
    }
  }

  async function handleAnalyzeNL() {
    setNlError("");
    if (!nlText.trim()) return;
    setNlLoading(true);
    try {
      const res = await fetch("/api/parse-nl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nlText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNlError(data.error || "분석 실패");
        return;
      }
      setNlResult(data);
      setNlOverrideDealId(data.dealId || "");
      setNlDate(data.date || "");
      setNlActionText(data.actionText || "");
    } catch (e) {
      setNlError(String(e.message || e));
    } finally {
      setNlLoading(false);
    }
  }

  async function handleConfirmNL() {
    if (!nlOverrideDealId) {
      setNlError("연결할 딜을 선택해주세요.");
      return;
    }
    setNlSaving(true);
    try {
      await addDoc(collection(db, "activityLog"), {
        dealId: nlOverrideDealId,
        date: nlDate || null,
        text: nlActionText,
        createdAt: serverTimestamp(),
      });
      setAllActivity((prev) => [...prev, { dealId: nlOverrideDealId, date: nlDate || null, text: nlActionText }]);
      setNlText("");
      setNlResult(null);
      setNlOverrideDealId("");
      setNlDate("");
      setNlActionText("");
    } catch (e) {
      setNlError("저장 실패: " + (e.message || e));
    } finally {
      setNlSaving(false);
    }
  }

  async function saveGridField(field) {
    if (field === "expectedPerformanceRaw") {
      await saveDealField({ expectedPerformanceRaw: editValue, expectedPerformance: parseAmountKR(editValue) });
    } else if (field === "contractAmount") {
      const num = editValue.replace(/[^0-9]/g, "");
      await saveDealField({ contractAmount: num ? parseInt(num, 10) : null });
    } else {
      await saveDealField({ [field]: editValue });
    }
  }

  function GridCell({ icon: Icon, label, field, displayValue }) {
    const editing = editingField === field;
    return (
      <div className="bg-white dark:bg-[#111827] px-4 py-3 group">
        <div className="text-[10px] text-gray-400 mb-0.5 flex items-center justify-between">
          <span className="flex items-center gap-1"><Icon className="w-3 h-3" />{label}</span>
          {!editing && (
            <button className="text-navy dark:text-gray-100 opacity-0 group-hover:opacity-100 transition text-[10px]" onClick={() => startEdit(field, selected[field])}>
              수정
            </button>
          )}
        </div>
        {!editing ? (
          <div className="text-xs font-semibold text-navy dark:text-gray-100 break-words">{displayValue}</div>
        ) : (
          <div className="space-y-1">
            <input
              className="w-full text-xs border border-[#E7EAF0] rounded-lg px-2 py-1"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              autoFocus
            />
            <div className="flex gap-1 justify-end">
              <button className="text-[10px] text-gray-400" onClick={cancelEdit}>취소</button>
              <button className="text-[10px] bg-navy text-white px-1.5 py-0.5 rounded" onClick={() => saveGridField(field)} disabled={saving}>저장</button>
            </div>
          </div>
        )}
      </div>
    );
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
    <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#0B1220] flex">
      <aside
        className={
          "shrink-0 bg-white dark:bg-[#111827] border-r border-[#ECEEF1] dark:border-gray-700 text-gray-700 dark:text-gray-300 flex flex-col relative transition-all duration-200 " +
          (sidebarCollapsed ? "w-[68px]" : "w-60")
        }
      >
        <div className={"flex items-center gap-2.5 border-b border-[#ECEEF1] " + (sidebarCollapsed ? "px-4 py-5 justify-center" : "px-5 py-5")}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
            <img src="/logo.png" alt="logo" className="w-full h-full object-contain" />
          </div>
          {!sidebarCollapsed && (
            <div>
              <div className="font-bold text-sm leading-tight text-gray-900 dark:text-gray-100">TechFin Pipeline</div>
              <div className="text-[10px] text-gray-400 leading-tight">Sales Growth Together</div>
            </div>
          )}
        </div>
        <nav className="flex-1 py-4">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.key}
              onClick={() => setView(item.key)}
              title={sidebarCollapsed ? item.label : undefined}
              className={
                "mx-3 mb-1 py-2.5 rounded-lg text-sm flex items-center gap-2.5 cursor-pointer " +
                (sidebarCollapsed ? "justify-center px-0" : "px-3") + " " +
                (view === item.key ? "bg-[#F1F3F6] dark:bg-gray-700 text-gray-900 dark:text-white font-semibold" : "text-gray-500 dark:text-gray-400 hover:bg-[#F8F9FB] dark:hover:bg-gray-800")
              }
            >
              <item.icon className="w-4 h-4 shrink-0" strokeWidth={2} />
              {!sidebarCollapsed && item.label}
            </div>
          ))}
        </nav>
        {!sidebarCollapsed && (
          <div className="p-4 text-[11px] text-gray-400 border-t border-[#ECEEF1] dark:border-gray-700">
            TechFin Ratings<br />세일즈추진팀
          </div>
        )}
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          className="absolute -right-3 top-16 w-6 h-6 rounded-full bg-white border border-[#E7EAF0] shadow-sm flex items-center justify-center text-gray-400 hover:text-navy"
        >
          {sidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
        </button>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="bg-white dark:bg-[#111827] border-b border-[#E7EAF0] dark:border-gray-700 px-7 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold text-navy dark:text-gray-100">
              {view === "dashboard" && "금융기관 세일즈 파이프라인"}
              {view === "pipeline" && "파이프라인 전체 목록"}
              {view === "orgs" && "기관현황"}
              {view === "report" && "리포트"}
              {view === "settings" && "설정"}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">주요 금융기관과의 협업 현황을 한눈에 확인하세요.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
              <input
                className="text-xs border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#111827] dark:text-gray-100 rounded-lg pl-8 pr-16 py-2 w-56"
                placeholder="업체명으로 검색..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchMatches[0]) {
                    openDeal(searchMatches[0].deals[0]);
                    setSearchOpen(false);
                  }
                }}
              />
              <button
                onClick={() => { if (searchMatches[0]) { openDeal(searchMatches[0].deals[0]); setSearchOpen(false); } }}
                className="absolute right-1 top-1/2 -translate-y-1/2 bg-navy text-white text-[10px] px-2 py-1.5 rounded-md"
              >
                검색
              </button>
              {searchOpen && search && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSearchOpen(false)} />
                  <div className="absolute left-0 top-11 w-full bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden max-h-72 overflow-y-auto">
                    {searchMatches.map((o) => (
                      <div
                        key={o.name}
                        onClick={() => { openDeal(o.deals[0]); setSearchOpen(false); }}
                        className="flex items-center px-3 py-2.5 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer text-xs font-semibold text-navy dark:text-gray-100"
                      >
                        <LogoBadge name={o.name} />{o.name}
                        <span className="text-gray-400 font-normal ml-1.5">{o.group}</span>
                      </div>
                    ))}
                    {searchMatches.length === 0 && (
                      <div className="px-3 py-4 text-center text-[11px] text-gray-300">일치하는 업체가 없습니다.</div>
                    )}
                  </div>
                </>
              )}
            </div>
            <span className="text-[11px] bg-green-50 text-green-600 px-2.5 py-1.5 rounded-full font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> 실시간 업데이트
            </span>
            <button
              onClick={() => setShowNewDeal(true)}
              className="text-[11px] bg-navy text-white px-3 py-2 rounded-lg font-semibold"
            >
              + 상세 등록
            </button>
            <button onClick={toggleDarkMode} className="text-gray-400 hover:text-navy dark:hover:text-gray-100 p-1.5">
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <div className="relative">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="text-gray-400 hover:text-navy p-1.5 relative"
              >
                <Bell className="w-4 h-4" />
                {(actionDueDeals.length + aiFlaggedDeals.length) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {actionDueDeals.length + aiFlaggedDeals.length}
                  </span>
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 top-10 w-72 bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden max-h-96 overflow-y-auto">
                    <div className="px-4 py-3 border-b border-[#E7EAF0] flex items-center justify-between">
                      <span className="text-xs font-extrabold text-navy dark:text-gray-100">🟠 액션 도래 (7일 이내)</span>
                      <span className="text-[10px] text-gray-400">{actionDueDeals.length}건</span>
                    </div>
                    <div>
                      {actionDueDeals.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => { openDeal(d); setNotifOpen(false); }}
                          className="px-4 py-2.5 border-b border-[#F4F6F9] dark:border-gray-800 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer"
                        >
                          <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                            <LogoBadge name={d.orgName} />{d.orgName}
                          </div>
                          <div className="text-[10px] text-red-500 mt-0.5 ml-[28px]">
                            {dealKpiCat[d.id]?.futureReason === "renewal"
                              ? `계약갱신 예정 · ${d.contractRenewalDate}`
                              : `${d.nextMeetingDate} ${d.nextMeetingNote || ""}`}
                          </div>
                        </div>
                      ))}
                      {actionDueDeals.length === 0 && (
                        <div className="px-4 py-4 text-center text-[11px] text-gray-300">임박한 액션이 없습니다.</div>
                      )}
                    </div>
                    <div className="px-4 py-3 border-b border-t border-[#E7EAF0] flex items-center justify-between">
                      <span className="text-xs font-extrabold text-pink-600 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />다음 액션 추천 (AI기반)</span>
                      <span className="text-[10px] text-gray-400">{aiFlaggedDeals.length}건</span>
                    </div>
                    <div>
                      {aiFlaggedDeals.map((d) => (
                        <div
                          key={d.id}
                          className="px-4 py-2.5 border-b border-[#F4F6F9] dark:border-gray-800 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 flex items-start justify-between gap-2"
                        >
                          <div onClick={() => { openDeal(d); setNotifOpen(false); }} className="flex-1 min-w-0 cursor-pointer">
                            <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                              <LogoBadge name={d.orgName} />{d.orgName}
                            </div>
                            <div className="text-[10px] text-pink-600 mt-0.5 ml-[28px]">{d.aiInsight}</div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); dismissAiInsight(d.id, d.aiInsightForAction); }}
                            className="text-gray-300 hover:text-gray-500 shrink-0 mt-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {aiFlaggedDeals.length === 0 && (
                        <div className="px-4 py-4 text-center text-[11px] text-gray-300">추천 항목이 없습니다.</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <div
                onClick={() => setProfileMenuOpen((v) => !v)}
                className="flex items-center gap-2 pl-3 border-l border-[#E7EAF0] cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-navy text-white text-xs flex items-center justify-center font-bold">
                  {(profile?.name || "?").slice(0, 1)}
                </div>
                <div className="text-xs leading-tight">
                  <div className="font-semibold text-navy dark:text-gray-100">{profile?.name || "이름 미설정"}</div>
                  <div className="text-gray-400">{profile?.division || ""}</div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-gray-300" />
              </div>
              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
                  <div className="absolute right-0 top-11 w-56 bg-white border border-[#E7EAF0] rounded-xl shadow-xl z-50 overflow-hidden py-1">
                    <button
                      onClick={() => { setProfileModalKey("favorites"); setProfileMenuOpen(false); }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-600 hover:bg-[#F8FAFC]"
                    >
                      <span className="flex items-center gap-2"><Star className="w-3.5 h-3.5" />내 관심업체</span>
                      <span className="text-gray-400">{favorites.length}</span>
                    </button>
                    <button
                      onClick={() => { setProfileModalKey("actionNeeded"); setProfileMenuOpen(false); }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-600 hover:bg-[#F8FAFC]"
                    >
                      <span className="flex items-center gap-2"><Flag className="w-3.5 h-3.5" />액션 필요 ({myActionNeededDeals.length})</span>
                    </button>
                  </div>
                </>
              )}
            </div>
            <button onClick={() => signOut(auth)} className="text-[11px] text-gray-400 hover:text-navy ml-2">
              로그아웃
            </button>
          </div>
        </header>

        <div className="p-7">
          <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4 mb-6">
            <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-2">⚡ 빠른 등록</div>
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs border border-[#E7EAF0] rounded-lg px-3 py-2"
                placeholder="예: 9월 20일 신한카드 미팅해서 계약서 전달함"
                value={nlText}
                onChange={(e) => setNlText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAnalyzeNL(); }}
              />
              <button
                className="text-xs bg-navy text-white px-4 py-2 rounded-lg font-semibold"
                onClick={handleAnalyzeNL}
                disabled={nlLoading}
              >
                {nlLoading ? "분석 중..." : "분석"}
              </button>
            </div>
            {nlError && <p className="text-xs text-red-600 mt-2">{nlError}</p>}

            {nlResult && (
              <div className="mt-3 border border-[#E7EAF0] rounded-xl p-3 bg-[#F8FAFC]">
                <div className="text-[11px] text-gray-400 mb-2">
                  {nlResult.dealId ? "AI가 딜을 찾았습니다. 확인 후 저장하세요." : "일치하는 딜을 못 찾았습니다. 직접 선택해주세요."}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <select
                    className="text-xs border border-[#E7EAF0] rounded-lg px-2 py-2 col-span-2"
                    value={nlOverrideDealId}
                    onChange={(e) => setNlOverrideDealId(e.target.value)}
                  >
                    <option value="">-- 딜 선택 --</option>
                    {deals.map((d) => (
                      <option key={d.id} value={d.id}>{d.orgName} - {d.targetProduct}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="text-xs border border-[#E7EAF0] rounded-lg px-2 py-2"
                    value={nlDate}
                    onChange={(e) => setNlDate(e.target.value)}
                  />
                </div>
                <textarea
                  className="w-full text-xs border border-[#E7EAF0] rounded-lg px-2 py-2 mb-2"
                  rows={2}
                  value={nlActionText}
                  onChange={(e) => setNlActionText(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <button className="text-xs text-gray-400" onClick={() => setNlResult(null)}>취소</button>
                  <button className="text-xs bg-navy text-white px-3 py-1.5 rounded-lg" onClick={handleConfirmNL} disabled={nlSaving}>
                    {nlSaving ? "저장 중..." : "진행이력에 추가"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-5 gap-3.5 mb-6">
            {KPI_DEFS.map((k) => (
              <div
                key={k.key}
                onClick={() => setKpiModalKey(k.key)}
                className={
                  "bg-white border rounded-2xl p-4 cursor-pointer transition " +
                  (activeKpi === k.key ? "border-navy ring-1 " + k.ring : "border-[#E7EAF0] dark:border-gray-700 hover:border-navy/40")
                }
              >
                <div className={"w-9 h-9 rounded-xl flex items-center justify-center mb-2 " + k.bg}>
                  <k.icon className={"w-[18px] h-[18px] " + k.color} strokeWidth={2.2} />
                </div>
                <div className={"text-2xl font-extrabold " + k.color}>{kpis[k.key]}</div>
                <div className="text-xs text-gray-500 mt-1">{k.label} <span className="text-gray-300">({k.meta})</span></div>
              </div>
            ))}
          </div>
          {activeKpi && (
            <div className="mb-4 -mt-3">
              <button className="text-xs text-navy dark:text-gray-100 underline" onClick={() => setActiveKpi(null)}>KPI 필터 해제</button>
            </div>
          )}

          {view === "dashboard" && (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-extrabold text-navy dark:text-gray-100">산업군별 주요 기관</h2>
                  <p className="text-xs text-gray-400 mt-0.5">각 카드를 선택하면 해당 그룹 딜만 아래 목록에서 확인할 수 있습니다.</p>
                </div>
                <div className="flex items-center gap-2">
                  {activeGroup !== "전체" && (
                    <button className="text-xs text-navy dark:text-gray-100 underline" onClick={() => setActiveGroup("전체")}>전체 보기</button>
                  )}
                  <div className="flex items-center bg-[#F0F2F5] dark:bg-gray-800 rounded-lg p-1">
                    <button
                      onClick={() => setGroupViewMode("card")}
                      className={"p-1.5 rounded-md " + (groupViewMode === "card" ? "bg-white dark:bg-gray-700 text-navy dark:text-gray-100 shadow-sm" : "text-gray-400")}
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setGroupViewMode("list")}
                      className={"p-1.5 rounded-md " + (groupViewMode === "list" ? "bg-white dark:bg-gray-700 text-navy dark:text-gray-100 shadow-sm" : "text-gray-400")}
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {groupViewMode === "card" ? (
                <div className="grid grid-cols-3 gap-4 mb-7">
                {groupCards.map((g) => (
                  <div
                    key={g.name}
                    onClick={() => setActiveGroup(activeGroup === g.name ? "전체" : g.name)}
                    className={
                      "bg-white dark:bg-[#111827] rounded-2xl border p-4 cursor-pointer transition " +
                      (activeGroup === g.name ? "border-navy ring-1 ring-navy" : "border-[#E7EAF0] dark:border-gray-700 hover:border-navy/40")
                    }
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-navy/10 flex items-center justify-center shrink-0">
                          <GroupIcon name={g.name} className="w-4 h-4 text-navy dark:text-gray-100" />
                        </div>
                        <div className="font-bold text-sm text-navy dark:text-gray-100">{g.name}</div>
                      </div>
                      <span className="text-gray-300">›</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mb-3 ml-10">총 {g.orgCount}개 기관</div>
                    <div className="flex items-center gap-1 mb-4 -ml-1">
                      <GroupDonut active7={g.active7} followUp={g.followUp} stale={g.stale} />
                      <div className="flex-1 space-y-2.5 pl-2">
                        <DonutLegendRow color="#16A34A" label="활발 진행 (최근 7일)" value={g.active7} />
                        <DonutLegendRow color="#2563EB" label="후속 필요 (8~30일)" value={g.followUp} />
                        <DonutLegendRow color="#DC2626" label="장기 정체 (30일 초과)" value={g.stale} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[10px] text-gray-400">주요 기업 ({g.allOrgs.length})</div>
                      <span className="text-[10px] text-navy dark:text-gray-100">전체보기 ›</span>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                      {g.allOrgs.map((o) => {
                        const cat = dealKpiCat[o.deal.id]?.recency;
                        const info = cat ? RECENCY_LABEL[cat] : null;
                        return (
                          <div
                            key={o.name}
                            onClick={(e) => { e.stopPropagation(); openDeal(o.deal); }}
                            className="flex items-center justify-between text-xs bg-[#F8FAFC] dark:bg-gray-800 hover:bg-[#EEF2F7] dark:hover:bg-gray-700 rounded-lg px-2 py-1.5 cursor-pointer"
                          >
                            <span className="flex items-center min-w-0">
                              <LogoBadge name={o.name} /><span className="truncate">{o.name}</span>
                            </span>
                            {info && (
                              <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-semibold shrink-0 ml-1.5 " + info[1]}>
                                {info[0]}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {g.allOrgs.length === 0 && <div className="text-[11px] text-gray-300">기관명 미상</div>}
                    </div>
                  </div>
                ))}
                </div>
              ) : (
                <div className="mb-7">
                  <div className="flex items-center gap-2 mb-3">
                    <select
                      className="text-xs border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#111827] dark:text-gray-100 rounded-lg px-2 py-1.5"
                      value={listFilterGroup}
                      onChange={(e) => setListFilterGroup(e.target.value)}
                    >
                      <option value="전체">전체 구분</option>
                      {GROUP_ORDER.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <select
                      className="text-xs border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#111827] dark:text-gray-100 rounded-lg px-2 py-1.5"
                      value={listFilterRecency}
                      onChange={(e) => setListFilterRecency(e.target.value)}
                    >
                      <option value="전체">전체 상태</option>
                      <option value="active7">활발 진행</option>
                      <option value="followUp">후속 필요</option>
                      <option value="stale">장기 정체</option>
                    </select>
                  </div>
                  <table className="deals">
                    <thead>
                      <tr>
                        <th>구분</th><th>업체명</th><th>타겟제품</th><th>상태</th><th>계약가능성</th><th>RM / SO</th><th>기대실적</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allOrgFlat
                        .filter((o) => listFilterGroup === "전체" || o.groupName === listFilterGroup)
                        .filter((o) => listFilterRecency === "전체" || dealKpiCat[o.deal.id]?.recency === listFilterRecency)
                        .filter((o) => !search || o.name.includes(search))
                        .map((o) => {
                          const cat = dealKpiCat[o.deal.id]?.recency;
                          const info = cat ? RECENCY_LABEL[cat] : null;
                          return (
                            <tr key={o.groupName + o.name} onClick={() => openDeal(o.deal)}>
                              <td>{o.groupName}</td>
                              <td style={{ fontWeight: 700 }}><LogoBadge name={o.name} />{o.name}</td>
                              <td>{(o.deal.targetProduct || "").replace(/\n/g, " ")}</td>
                              <td>{info && <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-semibold " + info[1]}>{info[0]}</span>}</td>
                              <td><span className={probPillClass(o.deal.probability)}>{o.deal.probability || "-"}</span></td>
                              <td>{[o.deal.rm, o.deal.so].filter(Boolean).join(" / ")}</td>
                              <td>{formatWon(o.deal.expectedPerformance)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {view === "dashboard" && (
            <table className="deals mt-2">
              <thead>
                <tr>
                  <th>구분</th><th>업체명</th><th>타겟 제품</th><th>RM / SO</th>
                  <th>기대실적</th><th>계약가능성</th><th>진행단계</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} onClick={() => openDeal(d)}>
                    <td>{mapGroupName(d.orgGroup)}</td>
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
          )}

          {view === "orgs" && (
            <div className="grid grid-cols-2 gap-3">
              {companyRows
                .filter((o) => !search || o.name.includes(search))
                .map((o) => (
                  <div
                    key={o.name}
                    onClick={() => openDeal(o.deals[0])}
                    className="bg-white border border-[#E7EAF0] rounded-xl p-4 cursor-pointer hover:border-navy/40"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center text-sm font-bold text-navy dark:text-gray-100">
                        <LogoBadge name={o.name} />{o.name}
                      </div>
                      <span className={"text-[10px] px-2 py-0.5 rounded-md font-semibold " + RECENCY_LABEL[o.dominant][1]}>
                        {RECENCY_LABEL[o.dominant][0]}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400 mb-2 ml-[28px]">{o.group}</div>
                    <div className="flex items-center gap-1.5 ml-[28px]">
                      {Object.entries(o.counts).filter(([, v]) => v > 0).map(([cat, v]) => (
                        <span key={cat} className="text-[10px] bg-[#F0F2F5] text-gray-600 px-2 py-1 rounded-md font-semibold">
                          {cat} {v}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {view === "report" && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4">
                  <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">구분별 계약금액 실적</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={groupCards.map((g) => ({ name: g.name, 계약금액: Math.round(g.contract / 1e8 * 100) / 100 }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E7EAF0" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 10 }} unit="억" />
                      <Tooltip formatter={(v) => `${v}억원`} />
                      <Bar
                        dataKey="계약금액"
                        fill="#0D1F4E"
                        radius={[4, 4, 0, 0]}
                        cursor="pointer"
                        onClick={(data) => setReportModal({ type: "group", key: data.name })}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4">
                  <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">계약가능성 분포</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={probDist}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={(e) => `${e.name} ${e.value}`}
                        cursor="pointer"
                        onClick={(entry) => setReportModal({ type: "prob", key: entry.name })}
                      >
                        {probDist.map((entry, i) => (
                          <Cell key={i} fill={["#16A34A", "#D97706", "#DC2626", "#0D1F4E", "#9CA3AF"][i % 5]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4 mb-6">
                <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">월별 활동(진행이력) 추이</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart
                    data={monthlyActivity}
                    onClick={(e) => { if (e && e.activeLabel) setReportModal({ type: "month", key: e.activeLabel }); }}
                    style={{ cursor: "pointer" }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7EAF0" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#C8A84B" strokeWidth={2} dot={{ r: 3 }} name="활동 건수" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <table className="deals mt-2">
                <thead>
                  <tr>
                    <th>구분</th><th>기관수</th><th>진행</th><th>마감임박</th><th>지연</th><th>기대실적 합계</th><th>계약금액 합계</th>
                  </tr>
                </thead>
                <tbody>
                  {groupCards.map((g) => (
                    <tr key={g.name}>
                      <td style={{ fontWeight: 700 }}>{g.name}</td>
                      <td>{g.orgCount}</td>
                      <td>{g.progress + g.done}</td>
                      <td>{g.due}</td>
                      <td>{g.delayed}</td>
                      <td>{formatWon(g.expected)}</td>
                      <td>{formatWon(g.contract)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view === "settings" && (
            <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-6 text-sm text-gray-500">
              설정 화면은 준비 중입니다.
            </div>
          )}
        </div>
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-navy-deep/30 z-30" onClick={() => setSelected(null)} />
          <div className="fixed top-0 right-0 w-[440px] max-w-full h-screen bg-white dark:bg-[#111827] z-40 overflow-y-auto shadow-2xl">
            <div className="px-6 py-5 border-b border-[#E7EAF0] relative bg-gradient-to-br from-white to-[#F4F6F9] shrink-0">
              <button className="absolute top-4 right-5 text-gray-400 hover:text-navy" onClick={() => setSelected(null)}>
                <X className="w-4 h-4" />
              </button>
              <div className="text-[10px] text-gray-400 mb-3 flex items-center gap-1">
                {panelOrigin ? (
                  <button
                    className="text-navy dark:text-gray-100 font-semibold hover:underline flex items-center gap-1"
                    onClick={() => { setSelected(null); setSelectedOrgName(panelOrigin); }}
                  >
                    ‹ {panelOrigin}
                  </button>
                ) : (
                  <>
                    <span>전체</span><span>›</span>
                    <span>{mapGroupName(selected.orgGroup)}</span>
                  </>
                )}
                <span>›</span>
                <span className="text-navy dark:text-gray-100 font-semibold">{(selected.targetProduct || selected.orgName).replace(/\n/g, " ")}</span>
              </div>

              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <LogoBadge name={selected.orgName} />
                    <h2 className="text-lg font-extrabold text-navy dark:text-gray-100">{selected.orgName}</h2>
                    <button onClick={() => toggleFavorite(selected.orgName)}>
                      <Star
                        className={"w-4 h-4 " + (favorites.includes(selected.orgName) ? "text-amber-400 fill-amber-400" : "text-gray-300")}
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-1 rounded-md font-semibold">
                      {mapGroupName(selected.orgGroup)}
                    </span>
                    {(() => {
                      const cat = dealKpiCat[selected.id];
                      const labelMap = { active7: ["활발 진행", "text-green-600 bg-green-50"], followUp: ["후속 필요", "text-blue-600 bg-blue-50"], stale: ["장기 정체", "text-red-600 bg-red-50"] };
                      const info = cat ? labelMap[cat.recency] : null;
                      return info ? <span className={"text-[10px] px-2 py-1 rounded-md font-semibold " + info[1]}>{info[0]}</span> : null;
                    })()}
                  </div>
                </div>
                {(() => {
                  const lastDate = lastActionByDeal[selected.id];
                  if (!lastDate) return null;
                  const days = Math.floor((new Date() - new Date(lastDate)) / 86400000);
                  const cat = dealKpiCat[selected.id]?.recency;
                  const colorMap = {
                    active7: ["bg-green-50", "text-green-600"],
                    followUp: ["bg-blue-50", "text-blue-600"],
                    stale: ["bg-red-50", "text-red-600"],
                  };
                  const [bg, textColor] = colorMap[cat] || ["bg-gray-50", "text-gray-500"];
                  const label = cat ? RECENCY_LABEL[cat][0] : "";
                  return (
                    <div className={"rounded-xl px-3 py-2 text-center " + bg}>
                      <div className={"text-sm font-extrabold " + textColor}>D+{days}</div>
                      <div className="text-[9px] text-gray-400 mt-0.5">{label} · {lastDate}</div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* AI 제안 배너 */}
            {selected.aiFlag && selected.aiInsight && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-900 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-pink-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-pink-600 mb-0.5">다음 액션 추천 (AI기반)</div>
                  <div className="text-xs text-pink-700 dark:text-pink-300">{selected.aiInsight}</div>
                </div>
              </div>
            )}

            {/* 타겟제품 전환 */}
            {(() => {
              const companyDeals = deals.filter((d) => (d.orgName || "").trim() === (selected.orgName || "").trim());
              const counts = { "Raw Data": 0, "플랫폼": 0, "기타": 0 };
              companyDeals.forEach((d) => counts[classifyTargetProduct(d.targetProduct)]++);
              const catList = Object.entries(counts).filter(([, v]) => v > 0);
              if (catList.length === 0) return null;
              const itemsInCat = companyDeals.filter((d) => classifyTargetProduct(d.targetProduct) === activeProductCat);
              return (
                <div className="px-6 py-4 border-b border-[#E7EAF0] shrink-0">
                  <div className="text-xs font-extrabold text-navy dark:text-gray-100 mb-2">타겟제품 ({companyDeals.length})</div>
                  <div className="flex gap-2 mb-2">
                    {catList.map(([cat, v]) => (
                      <button
                        key={cat}
                        onClick={() => setActiveProductCat(cat)}
                        className={
                          "text-xs px-3 py-1.5 rounded-lg font-semibold border " +
                          (activeProductCat === cat ? "bg-navy text-white border-navy" : "bg-white text-gray-500 border-[#E7EAF0]")
                        }
                      >
                        {cat} ({v})
                      </button>
                    ))}
                  </div>
                  {activeProductCat && (
                    <div className="space-y-1.5 mt-2">
                      {itemsInCat.map((d) => {
                        const cat = dealKpiCat[d.id];
                        const recInfo = cat ? RECENCY_LABEL[cat.recency] : null;
                        const isCurrent = d.id === selected.id;
                        return (
                          <div
                            key={d.id}
                            onClick={() => openDeal(d)}
                            className={
                              "border rounded-lg px-3 py-2 cursor-pointer " +
                              (isCurrent ? "border-navy bg-navy/5" : "border-[#E7EAF0] dark:border-gray-700 hover:border-navy/40")
                            }
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-navy dark:text-gray-100">
                                {(d.targetProduct || "").replace(/\n/g, " ") || "(제품명 없음)"}
                              </span>
                              {recInfo && (
                                <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-semibold " + recInfo[1]}>{recInfo[0]}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              {[d.rm, d.so].filter(Boolean).join(" / ") || "담당자 미상"} · {formatWon(d.expectedPerformance)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 액션 3종 카드 */}
            <div className="px-6 py-4 border-b border-[#E7EAF0] space-y-2 shrink-0">
              {[
                { icon: ClipboardList, color: "bg-blue-50 text-blue-600", label: "지난번 액션", date: activity[1]?.date, text: activity[1]?.text, field: "prevAction", editable: !!activity[1] },
                { icon: PlayCircle, color: "bg-navy/10 text-navy dark:text-gray-100", label: "현재 액션", date: activity[0]?.date, text: activity[0]?.text, field: "currentAction", editable: !!activity[0] },
                { icon: Flag, color: "bg-orange-100 text-orange-600", label: "다음 액션", date: selected.nextAction ? "예정" : null, text: selected.nextAction, field: "nextAction", editable: true, highlight: true },
              ].map((row) => (
                <div key={row.field} className={"rounded-xl border p-3 " + (row.highlight ? "border-orange-200 bg-orange-50" : "border-[#E7EAF0]")}>
                  <div className="flex items-start gap-2.5">
                    <div className={"w-7 h-7 rounded-lg flex items-center justify-center shrink-0 " + row.color}>
                      <row.icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-gray-500">{row.label}</span>
                        <div className="flex items-center gap-2">
                          {row.date && <span className="text-[10px] text-gray-400">{row.date}</span>}
                          {row.editable && editingField !== row.field && (
                            <button className="text-[10px] text-navy dark:text-gray-100 underline" onClick={() => startEdit(row.field, row.text)}>수정</button>
                          )}
                        </div>
                      </div>
                      {editingField !== row.field ? (
                        <div className="text-xs text-gray-700 mt-0.5">{row.text || "미입력"}</div>
                      ) : (
                        <div className="mt-1.5 space-y-1.5">
                          <input
                            className="w-full text-xs border border-[#E7EAF0] rounded-lg px-2 py-1.5"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                          />
                          <div className="flex gap-2 justify-end">
                            <button className="text-[10px] text-gray-400" onClick={cancelEdit}>취소</button>
                            <button
                              className="text-[10px] bg-navy text-white px-2 py-1 rounded-lg"
                              disabled={saving}
                              onClick={() =>
                                row.field === "nextAction"
                                  ? saveDealField({ nextAction: editValue })
                                  : saveActivityText(activity[row.field === "prevAction" ? 1 : 0].id)
                              }
                            >
                              {saving ? "저장 중..." : "저장"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 탭 */}
            <div className="flex border-b border-[#E7EAF0] dark:border-gray-700 px-2 sticky top-0 bg-white dark:bg-[#111827] z-10">
              {[
                { key: "info", label: "상세정보" },
                { key: "history", label: "액션 히스토리" },
                { key: "files", label: "관련파일" },
                { key: "related", label: "연관기관" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDetailTab(t.key)}
                  className={
                    "px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px " +
                    (detailTab === t.key ? "text-navy dark:text-gray-100 border-navy" : "text-gray-400 border-transparent")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div>
              {detailTab === "info" && (
                <>
                  <div className="grid grid-cols-2 gap-px bg-[#E7EAF0] dark:bg-gray-700 border-b border-[#E7EAF0] dark:border-gray-700">
                    <GridCell icon={Layers} label="타겟제품" field="targetProduct" displayValue={(selected.targetProduct || "").replace(/\n/g, " ") || "-"} />
                    <GridCell icon={User} label="담당자" field="contactPerson" displayValue={selected.contactPerson || "-"} />
                    <GridCell icon={Users} label="RM" field="rm" displayValue={selected.rm || "-"} />
                    <GridCell icon={Users} label="SO" field="so" displayValue={selected.so || "-"} />
                    <GridCell icon={TrendingUp} label="기대실적" field="expectedPerformanceRaw" displayValue={formatWon(selected.expectedPerformance)} />
                    <GridCell icon={Wallet} label="계약금액" field="contractAmount" displayValue={formatWon(selected.contractAmount)} />
                    <GridCell icon={CalendarClock} label="계약목표" field="contractGoal" displayValue={selected.contractGoal || "-"} />
                    <GridCell icon={CalendarClock} label="계약갱신일" field="contractRenewalDate" displayValue={selected.contractRenewalDate || "-"} />

                    <div className="bg-white dark:bg-[#111827] px-4 py-3">
                      <div className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1"><Layers className="w-3 h-3" />진행단계</div>
                      <select
                        className="text-xs font-semibold text-navy dark:text-gray-100 border-none bg-transparent -ml-0.5 focus:outline-none focus:ring-1 focus:ring-navy rounded"
                        value={selected.stage || ""}
                        onChange={(e) => saveDealField({ stage: e.target.value })}
                      >
                        <option value="">-</option>
                        {["1단계", "2단계", "3단계", "4단계"].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="px-6 py-3 border-b border-[#E7EAF0]">
                    <div className="text-[10px] text-gray-400 mb-1 flex items-center gap-1"><Percent className="w-3 h-3" />계약가능성</div>
                    <select
                      className="text-xs font-semibold border border-[#E7EAF0] rounded-lg px-2 py-1"
                      value={selected.probability || ""}
                      onChange={(e) => saveDealField({ probability: e.target.value })}
                    >
                      <option value="">미상</option>
                      {["상", "중", "하", "완료"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  <div className="px-6 py-3 border-b border-[#E7EAF0]">
                    <div className="text-[10px] text-gray-400 mb-1">방문미팅</div>
                    <div className="text-xs text-gray-700">{selected.visitMeetingRaw || "-"}</div>
                  </div>

                  <div className="px-6 py-4 border-b border-[#E7EAF0]">
                    <EditableLine
                      label="메모"
                      icon={FileText}
                      value={selected.memo}
                      editing={editingField === "memo"}
                      editable
                      multiline
                      editValue={editValue}
                      setEditValue={setEditValue}
                      onEdit={() => startEdit("memo", selected.memo)}
                      onCancel={cancelEdit}
                      onSave={() => saveDealField({ memo: editValue })}
                      saving={saving}
                    />
                  </div>

                  <div className="px-6 py-4 border-b border-[#E7EAF0]">
                    <div className="text-[10px] text-gray-400 mb-1">다음 미팅</div>
                    {editingField !== "meeting" ? (
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-700">
                          {selected.nextMeetingDate ? `${selected.nextMeetingDate} ${selected.nextMeetingNote || ""}` : "미입력"}
                        </div>
                        <button className="text-[10px] text-navy dark:text-gray-100 underline" onClick={() => setEditingField("meeting")}>수정</button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex gap-1.5">
                          <input type="date" className="border border-[#E7EAF0] rounded-lg px-2 py-1.5 w-1/2 text-xs" value={editMeetingDate} onChange={(e) => setEditMeetingDate(e.target.value)} />
                          <input className="border border-[#E7EAF0] rounded-lg px-2 py-1.5 w-1/2 text-xs" placeholder="메모" value={editMeetingNote} onChange={(e) => setEditMeetingNote(e.target.value)} />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button className="text-[10px] text-gray-400" onClick={() => setEditingField(null)}>취소</button>
                          <button className="text-[10px] bg-navy text-white px-2.5 py-1 rounded-lg" onClick={saveMeeting} disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="px-6 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs font-extrabold text-navy dark:text-gray-100">주요 히스토리 (최근 3건)</div>
                      <button className="text-[10px] text-navy dark:text-gray-100" onClick={() => setDetailTab("history")}>전체보기 ›</button>
                    </div>
                    <div className="relative pl-4 space-y-4 border-l-2 border-[#E7EAF0]">
                      {activity.slice(0, 3).map((a, i) => (
                        <div key={i} className="relative">
                          <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-navy border-2 border-white ring-1 ring-[#E7EAF0]" />
                          <div className="text-[11px] text-gray-400 mb-0.5">{a.date || "날짜 미상"}</div>
                          <div className="text-xs text-gray-700 leading-relaxed">{a.text}</div>
                        </div>
                      ))}
                      {activity.length === 0 && <div className="text-xs text-gray-300">이력이 없습니다.</div>}
                    </div>
                  </div>
                </>
              )}

              {detailTab === "history" && (
                <div className="px-6 py-4">
                  <div className="text-xs font-extrabold text-navy dark:text-gray-100 mb-3">액션 히스토리 ({activity.length})</div>
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
              )}

              {detailTab === "files" && (
                <div className="px-6 py-4">
                  <div className="text-xs font-extrabold text-navy dark:text-gray-100 mb-3">관련파일 ({(selected.relatedFiles || []).length})</div>
                  <div className="space-y-1.5 mb-3">
                    {(selected.relatedFiles || []).map((f, i) => {
                      const label = typeof f === "string" ? f : f.label;
                      const url = typeof f === "string" ? null : f.url;
                      const content = (
                        <div className="text-xs text-gray-700 bg-[#F8FAFC] dark:bg-gray-800 hover:bg-[#EEF2F7] dark:hover:bg-gray-700 rounded-lg px-3 py-2 break-words flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-gray-300 shrink-0" />{label}
                        </div>
                      );
                      return url ? (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                          {content}
                        </a>
                      ) : (
                        <div key={i}>{content}</div>
                      );
                    })}
                    {(!selected.relatedFiles || selected.relatedFiles.length === 0) && (
                      <div className="text-xs text-gray-300">관련파일이 없습니다.</div>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-300 mb-3">※ 더존 사내 그룹웨어 링크는 로그인된 상태에서만 열립니다.</div>

                  <div className="border-t border-[#E7EAF0] pt-3 space-y-2">
                    {!addingLink ? (
                      <button className="text-[11px] text-navy dark:text-gray-100 underline" onClick={() => setAddingLink(true)}>+ 링크 추가</button>
                    ) : (
                      <div className="space-y-1.5">
                        <input
                          className="w-full text-xs border border-[#E7EAF0] rounded-lg px-2 py-1.5"
                          placeholder="파일/문서 이름"
                          value={newLinkLabel}
                          onChange={(e) => setNewLinkLabel(e.target.value)}
                        />
                        <input
                          className="w-full text-xs border border-[#E7EAF0] rounded-lg px-2 py-1.5"
                          placeholder="https://..."
                          value={newLinkUrl}
                          onChange={(e) => setNewLinkUrl(e.target.value)}
                        />
                        <div className="flex gap-2 justify-end">
                          <button className="text-[10px] text-gray-400" onClick={() => setAddingLink(false)}>취소</button>
                          <button className="text-[10px] bg-navy text-white px-2.5 py-1 rounded-lg" onClick={handleAddLink}>추가</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {detailTab === "related" && (
                <div className="px-6 py-4 space-y-5">
                  {(() => {
                    const canon = canonicalOrg(selected.orgName);
                    const sameCompany = deals.filter((d) => d.id !== selected.id && canonicalOrg(d.orgName) === canon);
                    if (sameCompany.length === 0) return null;
                    return (
                      <div>
                        <div className="text-xs font-extrabold text-navy dark:text-gray-100 mb-2">같은 회사 (다른 부서·담당)</div>
                        <div className="space-y-1.5">
                          {sameCompany.map((d) => (
                            <div
                              key={d.id}
                              onClick={() => openDeal(d)}
                              className="flex items-center justify-between text-xs bg-orange-50 hover:bg-orange-100 rounded-lg px-3 py-2 cursor-pointer"
                            >
                              <div className="flex items-center">
                                <LogoBadge name={d.orgName} />
                                <div>
                                  <div className="font-semibold">{d.orgName}</div>
                                  <div className="text-[10px] text-gray-400">{(d.targetProduct || "").replace(/\n/g, " ")}</div>
                                </div>
                              </div>
                              <span className="text-gray-300">›</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <div className="text-xs font-extrabold text-navy dark:text-gray-100 mb-2">같은 구분 ({mapGroupName(selected.orgGroup)})</div>
                    <div className="space-y-1.5">
                      {(groupCards.find((g) => g.name === mapGroupName(selected.orgGroup))?.allOrgs || [])
                        .filter((o) => o.name !== selected.orgName)
                        .map((o) => (
                          <div
                            key={o.name}
                            onClick={() => openDeal(o.deal)}
                            className="flex items-center text-xs bg-[#F8FAFC] dark:bg-gray-800 hover:bg-[#EEF2F7] dark:hover:bg-gray-700 rounded-lg px-3 py-2 cursor-pointer"
                          >
                            <LogoBadge name={o.name} />{o.name}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}


      {reportModal && (() => {
        let title = "", items = [];
        if (reportModal.type === "group") {
          title = `${reportModal.key} · 계약금액 상세`;
          items = deals.filter((d) => mapGroupName(d.orgGroup) === reportModal.key)
            .filter((d) => d.contractAmount)
            .sort((a, b) => (b.contractAmount || 0) - (a.contractAmount || 0));
        } else if (reportModal.type === "prob") {
          title = `계약가능성: ${reportModal.key}`;
          const known = ["상", "중", "하", "완료"];
          items = deals.filter((d) => (known.includes(reportModal.key) ? d.probability === reportModal.key : !known.includes(d.probability)));
        } else if (reportModal.type === "month") {
          title = `${reportModal.key} 활동 내역`;
          const dealsById = {};
          deals.forEach((d) => { dealsById[d.id] = d; });
          items = allActivity
            .filter((a) => a.date && a.date.slice(0, 7) === reportModal.key)
            .map((a) => ({ ...a, deal: dealsById[a.dealId] }))
            .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        }
        return (
          <>
            <div className="fixed inset-0 bg-navy-deep/40 z-50" onClick={() => setReportModal(null)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <div className="bg-white dark:bg-[#111827] rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto pointer-events-auto shadow-2xl">
                <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-[#111827]">
                  <span className="text-sm font-extrabold text-navy dark:text-gray-100">{title}</span>
                  <button className="text-gray-400 hover:text-navy" onClick={() => setReportModal(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-gray-400 px-2 mb-1">{items.length}건</div>

                  {reportModal.type === "month"
                    ? items.map((a, i) => (
                        <div
                          key={i}
                          onClick={() => { if (a.deal) { openDeal(a.deal); setReportModal(null); } }}
                          className="px-3 py-2.5 rounded-lg hover:bg-[#F8FAFC] cursor-pointer"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-navy dark:text-gray-100 flex items-center">
                              {a.deal && <LogoBadge name={a.deal.orgName} />}
                              {a.deal ? a.deal.orgName : "(삭제된 딜)"}
                            </span>
                            <span className="text-[10px] text-gray-400">{a.date}</span>
                          </div>
                          <div className="text-[11px] text-gray-600 mt-0.5">{a.text}</div>
                        </div>
                      ))
                    : items.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => { openDeal(d); setReportModal(null); }}
                          className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#F8FAFC] cursor-pointer"
                        >
                          <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                            <LogoBadge name={d.orgName} />{d.orgName}
                            <span className="text-gray-300 font-normal ml-1.5">{(d.targetProduct || "").replace(/\n/g, " ")}</span>
                          </div>
                          {reportModal.type === "group" && (
                            <span className="text-[10px] text-navy dark:text-gray-100 font-bold shrink-0 ml-2">{formatWon(d.contractAmount)}</span>
                          )}
                        </div>
                      ))}

                  {items.length === 0 && <div className="text-center text-xs text-gray-300 py-8">해당하는 내역이 없습니다.</div>}
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {profileModalKey && (() => {
        const isFav = profileModalKey === "favorites";
        const title = isFav ? "내 관심업체" : "액션 필요";
        const favCompanies = companyRows.filter((o) => favorites.includes(o.name));
        return (
          <>
            <div className="fixed inset-0 bg-navy-deep/40 z-50" onClick={() => setProfileModalKey(null)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <div className="bg-white dark:bg-[#111827] rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto pointer-events-auto shadow-2xl">
                <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-[#111827]">
                  <div className="flex items-center gap-2">
                    {isFav ? <Star className="w-4 h-4 text-amber-400" /> : <Flag className="w-4 h-4 text-orange-500" />}
                    <span className="text-sm font-extrabold text-navy dark:text-gray-100">{title}</span>
                  </div>
                  <button className="text-gray-400 hover:text-navy" onClick={() => setProfileModalKey(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-3">
                  {isFav ? (
                    <>
                      <div className="text-[11px] text-gray-400 px-2 mb-1">{favCompanies.length}개 기관</div>
                      {favCompanies.map((o) => (
                        <div
                          key={o.name}
                          onClick={() => { openDeal(o.deals[0]); setProfileModalKey(null); }}
                          className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#F8FAFC] cursor-pointer"
                        >
                          <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                            <LogoBadge name={o.name} />{o.name}
                          </div>
                          <span className={"text-[10px] px-1.5 py-0.5 rounded-md font-semibold " + RECENCY_LABEL[o.dominant][1]}>
                            {RECENCY_LABEL[o.dominant][0]}
                          </span>
                        </div>
                      ))}
                      {favCompanies.length === 0 && <div className="text-center text-xs text-gray-300 py-8">별표를 눌러 관심업체를 등록해보세요.</div>}
                    </>
                  ) : (
                    <>
                      <div className="text-[11px] text-gray-400 px-2 mb-1">{myActionNeededDeals.length}건</div>
                      {myActionNeededDeals.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => { openDeal(d); setProfileModalKey(null); }}
                          className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#F8FAFC] cursor-pointer"
                        >
                          <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                            <LogoBadge name={d.orgName} />{d.orgName}
                            <span className="text-gray-300 font-normal ml-1.5">{(d.targetProduct || "").replace(/\n/g, " ")}</span>
                          </div>
                          <span className="text-[10px] text-orange-500 shrink-0 ml-2">
                            {dealKpiCat[d.id]?.future === "actionDue" ? "도래" : "예정"}
                          </span>
                        </div>
                      ))}
                      {myActionNeededDeals.length === 0 && <div className="text-center text-xs text-gray-300 py-8">해당하는 딜이 없습니다.</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {kpiModalKey && (() => {
        const def = KPI_DEFS.find((k) => k.key === kpiModalKey);
        const matched = deals
          .filter((d) => {
            if (kpiModalKey === "aiFlag") return !!d.aiFlag;
            const c = dealKpiCat[d.id];
            return c?.recency === kpiModalKey || c?.future === kpiModalKey;
          })
          .sort((a, b) => (lastActionByDeal[b.id] || "").localeCompare(lastActionByDeal[a.id] || ""));
        return (
          <>
            <div className="fixed inset-0 bg-navy-deep/40 z-50" onClick={() => setKpiModalKey(null)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <div className="bg-white dark:bg-[#111827] rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto pointer-events-auto shadow-2xl">
                <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-[#111827]">
                  <div className="flex items-center gap-2">
                    <def.icon className={"w-4 h-4 " + def.color} />
                    <span className="text-sm font-extrabold text-navy dark:text-gray-100">{def.label}</span>
                    <span className="text-xs text-gray-400">({def.meta})</span>
                  </div>
                  <button className="text-gray-400 hover:text-navy" onClick={() => setKpiModalKey(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-gray-400 px-2 mb-1">{matched.length}건</div>
                  {matched.map((d) => (
                    <div
                      key={d.id}
                      onClick={() => { openDeal(d); setKpiModalKey(null); }}
                      className="px-3 py-2.5 rounded-lg hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                          <LogoBadge name={d.orgName} />{d.orgName}
                          <span className="text-gray-300 font-normal ml-1.5">{(d.targetProduct || "").replace(/\n/g, " ")}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 shrink-0 ml-2">{lastActionByDeal[d.id] || ""}</span>
                      </div>
                      {kpiModalKey === "aiFlag" && d.aiInsight && (
                        <div className="text-[11px] text-pink-600 mt-1 ml-[28px]">✨ {d.aiInsight}</div>
                      )}
                    </div>
                  ))}
                  {matched.length === 0 && (
                    <div className="text-center text-xs text-gray-300 py-8">해당하는 딜이 없습니다.</div>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {showNewDeal && (
        <>
          <div className="fixed inset-0 bg-navy-deep/40 z-50" onClick={() => setShowNewDeal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white dark:bg-[#111827] rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 pointer-events-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-extrabold text-navy dark:text-gray-100">상세 등록</h3>
                <button className="text-gray-400 text-lg" onClick={() => setShowNewDeal(false)}>✕</button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-gray-400 block mb-1">구분</label>
                  <select
                    className="w-full border border-[#E7EAF0] rounded-lg px-3 py-2"
                    value={newDeal.orgGroup}
                    onChange={(e) => setNewDeal({ ...newDeal, orgGroup: e.target.value })}
                  >
                    {GROUP_ORDER.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">업체명 *</label>
                  <input className="w-full border border-[#E7EAF0] rounded-lg px-3 py-2" value={newDeal.orgName} onChange={(e) => setNewDeal({ ...newDeal, orgName: e.target.value })} />
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">타겟 제품</label>
                  <input className="w-full border border-[#E7EAF0] rounded-lg px-3 py-2" value={newDeal.targetProduct} onChange={(e) => setNewDeal({ ...newDeal, targetProduct: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-gray-400 block mb-1">담당자</label>
                    <input className="w-full border border-[#E7EAF0] rounded-lg px-2 py-2" value={newDeal.contactPerson} onChange={(e) => setNewDeal({ ...newDeal, contactPerson: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">RM</label>
                    <input className="w-full border border-[#E7EAF0] rounded-lg px-2 py-2" value={newDeal.rm} onChange={(e) => setNewDeal({ ...newDeal, rm: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">SO</label>
                    <input className="w-full border border-[#E7EAF0] rounded-lg px-2 py-2" value={newDeal.so} onChange={(e) => setNewDeal({ ...newDeal, so: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">기대실적 (예: 3.1억원, 3000만원)</label>
                  <input className="w-full border border-[#E7EAF0] rounded-lg px-3 py-2" value={newDeal.expectedPerformanceRaw} onChange={(e) => setNewDeal({ ...newDeal, expectedPerformanceRaw: e.target.value })} />
                  {newDeal.expectedPerformanceRaw && (
                    <div className="text-[10px] text-gray-400 mt-1">
                      인식된 금액: {parseAmountKR(newDeal.expectedPerformanceRaw) !== null ? formatWon(parseAmountKR(newDeal.expectedPerformanceRaw)) : "인식 안됨(그냥 텍스트로만 저장)"}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-gray-400 block mb-1">계약목표</label>
                    <input className="w-full border border-[#E7EAF0] rounded-lg px-2 py-2" placeholder="예: 12월" value={newDeal.contractGoal} onChange={(e) => setNewDeal({ ...newDeal, contractGoal: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">계약가능성</label>
                    <select className="w-full border border-[#E7EAF0] rounded-lg px-2 py-2" value={newDeal.probability} onChange={(e) => setNewDeal({ ...newDeal, probability: e.target.value })}>
                      {["상", "중", "하", "완료"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">진행단계</label>
                    <select className="w-full border border-[#E7EAF0] rounded-lg px-2 py-2" value={newDeal.stage} onChange={(e) => setNewDeal({ ...newDeal, stage: e.target.value })}>
                      {["1단계", "2단계", "3단계", "4단계"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">방문미팅</label>
                  <input className="w-full border border-[#E7EAF0] rounded-lg px-3 py-2" value={newDeal.visitMeetingRaw} onChange={(e) => setNewDeal({ ...newDeal, visitMeetingRaw: e.target.value })} />
                </div>

                <div className="pt-2 border-t border-[#E7EAF0]">
                  <label className="text-gray-400 block mb-1">최초 액션 (선택 — 입력하면 진행이력에 자동 추가)</label>
                  <div className="flex gap-2">
                    <input type="date" className="border border-[#E7EAF0] rounded-lg px-2 py-2 w-1/3" value={newDeal.firstActionDate} onChange={(e) => setNewDeal({ ...newDeal, firstActionDate: e.target.value })} />
                    <input className="border border-[#E7EAF0] rounded-lg px-2 py-2 flex-1" placeholder="예: 킥오프 미팅 진행" value={newDeal.firstActionText} onChange={(e) => setNewDeal({ ...newDeal, firstActionText: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button className="text-gray-400 text-xs" onClick={() => setShowNewDeal(false)}>취소</button>
                <button className="bg-navy text-white text-xs px-4 py-2 rounded-lg" onClick={handleCreateDeal} disabled={creatingDeal}>
                  {creatingDeal ? "등록 중..." : "등록"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
