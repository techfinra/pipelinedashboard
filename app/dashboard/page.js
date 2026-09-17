'use client';

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, query, where, doc, getDoc, updateDoc, addDoc, serverTimestamp } from "firebase/firestore";
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

function GroupDonut({ progress, due, delayed }) {
  const total = progress + due + delayed || 0;
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  const raw = [
    { name: "진행", value: progress, color: "#16A34A" },
    { name: "마감임박", value: due, color: "#D97706" },
    { name: "지연", value: delayed, color: "#DC2626" },
  ];
  const data = total > 0 ? raw.filter((d) => d.value > 0) : [{ name: "없음", value: 1, color: "#E5E7EB" }];
  return (
    <div className="relative w-[104px] h-[104px] shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="70%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            paddingAngle={data.length > 1 ? 3 : 0}
            cornerRadius={6}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-lg font-extrabold text-navy leading-none">{pct}%</span>
        <span className="text-[9px] text-gray-400 mt-0.5">진행률</span>
      </div>
    </div>
  );
}

function DonutLegendRow({ color, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        {label}
      </span>
      <span className="text-sm font-extrabold text-navy">{value}</span>
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
          <button className="text-navy underline" onClick={onEdit}>수정</button>
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
  const [view, setView] = useState("dashboard");
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
      if (d.nextMeetingDate) {
        const diffFuture = Math.floor((new Date(d.nextMeetingDate) - now) / 86400000);
        if (diffFuture >= 0 && diffFuture <= 7) future = "actionDue";
        else if (diffFuture > 7) future = "actionPlanned";
      }
      map[d.id] = { recency, future };
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
      if (!map[g]) map[g] = { name: g, orgs: new Set(), progress: 0, due: 0, delayed: 0, done: 0, orgReps: {}, expected: 0, contract: 0 };
      map[g].orgs.add((d.orgName || "").trim());
      const cls = classifyDeal(d, curMonth, nextMonth);
      map[g][cls]++;
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
  }, [deals]);

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

  async function openDeal(deal) {
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
              onClick={() => setView(item.key)}
              className={
                "mx-3 mb-1 px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 cursor-pointer " +
                (view === item.key ? "bg-white/10 text-white font-semibold" : "text-white/60 hover:bg-white/5")
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
            <h1 className="text-lg font-extrabold text-navy">
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
              <Search className="w-3.5 h-3.5 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="text-xs border border-[#E7EAF0] rounded-lg pl-8 pr-3 py-2 w-56"
                placeholder="기관명으로 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <span className="text-[11px] bg-green-50 text-green-600 px-2.5 py-1.5 rounded-full font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> 실시간 업데이트
            </span>
            <button
              onClick={() => setShowNewDeal(true)}
              className="text-[11px] bg-navy text-white px-3 py-2 rounded-lg font-semibold"
            >
              + 새 딜 등록
            </button>
            <button className="text-gray-400 hover:text-navy p-1.5">
              <Bell className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 pl-3 border-l border-[#E7EAF0]">
              <div className="w-8 h-8 rounded-full bg-navy text-white text-xs flex items-center justify-center font-bold">
                {(profile?.name || "?").slice(0, 1)}
              </div>
              <div className="text-xs leading-tight">
                <div className="font-semibold text-navy">{profile?.name || "이름 미설정"}</div>
                <div className="text-gray-400">{profile?.division || ""}</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <button onClick={() => signOut(auth)} className="text-[11px] text-gray-400 hover:text-navy ml-2">
              로그아웃
            </button>
          </div>
        </header>

        <div className="p-7">
          <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4 mb-6">
            <div className="text-sm font-extrabold text-navy mb-2">✨ 자연어 입력</div>
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
            {[
              { key: "active7", value: kpis.active7, color: "text-green-600", bg: "bg-green-50", ring: "ring-green-500", icon: PlayCircle, label: "활발 진행", meta: "최근 7일" },
              { key: "followUp", value: kpis.followUp, color: "text-blue-600", bg: "bg-blue-50", ring: "ring-blue-500", icon: Clock3, label: "후속 필요", meta: "8~30일" },
              { key: "stale", value: kpis.stale, color: "text-red-600", bg: "bg-red-50", ring: "ring-red-500", icon: AlertTriangle, label: "장기 정체", meta: "30일 초과" },
              { key: "actionDue", value: kpis.actionDue, color: "text-orange-500", bg: "bg-orange-50", ring: "ring-orange-400", icon: Flag, label: "액션 도래", meta: "7일 이내" },
              { key: "actionPlanned", value: kpis.actionPlanned, color: "text-purple-600", bg: "bg-purple-50", ring: "ring-purple-500", icon: CalendarClock, label: "액션 예정", meta: "8일 이후" },
            ].map((k) => (
              <div
                key={k.key}
                onClick={() => setActiveKpi(activeKpi === k.key ? null : k.key)}
                className={
                  "bg-white border rounded-2xl p-4 cursor-pointer transition " +
                  (activeKpi === k.key ? "border-navy ring-1 " + k.ring : "border-[#E7EAF0] hover:border-navy/40")
                }
              >
                <div className={"w-9 h-9 rounded-xl flex items-center justify-center mb-2 " + k.bg}>
                  <k.icon className={"w-[18px] h-[18px] " + k.color} strokeWidth={2.2} />
                </div>
                <div className={"text-2xl font-extrabold " + k.color}>{k.value}</div>
                <div className="text-xs text-gray-500 mt-1">{k.label} <span className="text-gray-300">({k.meta})</span></div>
              </div>
            ))}
          </div>
          {activeKpi && (
            <div className="mb-4 -mt-3">
              <button className="text-xs text-navy underline" onClick={() => setActiveKpi(null)}>KPI 필터 해제</button>
            </div>
          )}

          {view === "dashboard" && (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-extrabold text-navy">산업군별 주요 기관</h2>
                  <p className="text-xs text-gray-400 mt-0.5">각 카드를 선택하면 해당 그룹 딜만 아래 목록에서 확인할 수 있습니다.</p>
                </div>
                <div className="flex items-center gap-2">
                  {activeGroup !== "전체" && (
                    <button className="text-xs text-navy underline" onClick={() => setActiveGroup("전체")}>전체 보기</button>
                  )}
                  <div className="flex items-center bg-[#F0F2F5] rounded-lg p-1">
                    <button className="p-1.5 rounded-md bg-white text-navy shadow-sm"><LayoutGrid className="w-4 h-4" /></button>
                    <button className="p-1.5 rounded-md text-gray-400"><List className="w-4 h-4" /></button>
                  </div>
                </div>
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
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-navy/10 flex items-center justify-center shrink-0">
                          <GroupIcon name={g.name} className="w-4 h-4 text-navy" />
                        </div>
                        <div className="font-bold text-sm text-navy">{g.name}</div>
                      </div>
                      <span className="text-gray-300">›</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mb-3 ml-10">총 {g.orgCount}개 기관</div>
                    <div className="flex items-center gap-1 mb-4 -ml-1">
                      <GroupDonut progress={g.progress + g.done} due={g.due} delayed={g.delayed} />
                      <div className="flex-1 space-y-2.5 pl-2">
                        <DonutLegendRow color="#16A34A" label="진행" value={g.progress + g.done} />
                        <DonutLegendRow color="#D97706" label="마감임박" value={g.due} />
                        <DonutLegendRow color="#DC2626" label="지연" value={g.delayed} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[10px] text-gray-400">주요 기업 ({g.allOrgs.length})</div>
                      <span className="text-[10px] text-navy">전체보기 ›</span>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                      {g.allOrgs.map((o) => (
                        <div
                          key={o.name}
                          onClick={(e) => { e.stopPropagation(); openDeal(o.deal); }}
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
            </>
          )}

          {(view === "dashboard" || view === "pipeline") && (
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
            <table className="deals mt-2">
              <thead>
                <tr>
                  <th>업체명</th><th>구분</th><th>딜 건수</th><th>기대실적 합계</th><th>계약금액 합계</th>
                </tr>
              </thead>
              <tbody>
                {orgRows.map((o) => (
                  <tr key={o.name} onClick={() => openDeal(o.bestDeal)}>
                    <td style={{ fontWeight: 700 }}><LogoBadge name={o.name} />{o.name}</td>
                    <td>{o.group}</td>
                    <td>{o.count}</td>
                    <td>{formatWon(o.expected)}</td>
                    <td>{formatWon(o.contract)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {view === "report" && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4">
                  <div className="text-sm font-extrabold text-navy mb-3">구분별 기대실적 합계</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={groupCards.map((g) => ({ name: g.name, 기대실적: Math.round(g.expected / 1e8 * 10) / 10 }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E7EAF0" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 10 }} unit="억" />
                      <Tooltip formatter={(v) => `${v}억원`} />
                      <Bar dataKey="기대실적" fill="#0D1F4E" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4">
                  <div className="text-sm font-extrabold text-navy mb-3">계약가능성 분포</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={probDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => `${e.name} ${e.value}`}>
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

              <div className="bg-white border border-[#E7EAF0] rounded-2xl p-4 mb-6">
                <div className="text-sm font-extrabold text-navy mb-3">월별 활동(진행이력) 추이</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={monthlyActivity}>
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
            <div className="bg-white border border-[#E7EAF0] rounded-2xl p-6 text-sm text-gray-500">
              설정 화면은 준비 중입니다.
            </div>
          )}
        </div>
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-navy-deep/30 z-30" onClick={() => setSelected(null)} />
          <div className="fixed top-0 right-0 w-[440px] max-w-full h-screen bg-white z-40 overflow-y-auto shadow-2xl flex flex-col">
            <div className="px-6 py-5 border-b border-[#E7EAF0] relative bg-gradient-to-br from-white to-[#F4F6F9] shrink-0">
              <button className="absolute top-4 right-5 text-gray-400 hover:text-navy" onClick={() => setSelected(null)}>
                <X className="w-4 h-4" />
              </button>
              <div className="text-[10px] text-gray-400 mb-3 flex items-center gap-1">
                <span>전체</span><span>›</span>
                <span>{mapGroupName(selected.orgGroup)}</span><span>›</span>
                <span className="text-navy font-semibold">{selected.orgName}</span>
              </div>

              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <LogoBadge name={selected.orgName} />
                    <h2 className="text-lg font-extrabold text-navy">{selected.orgName}</h2>
                    <Star className="w-4 h-4 text-gray-300" />
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
                  const dd = ddayFromGoal(selected.contractGoal);
                  if (!dd) return null;
                  const overdue = dd.diff < 0;
                  return (
                    <div className={"rounded-xl px-3 py-2 text-center " + (overdue ? "bg-red-50" : "bg-green-50")}>
                      <div className={"text-sm font-extrabold " + (overdue ? "text-red-600" : "text-green-600")}>
                        {overdue ? `D+${Math.abs(dd.diff)}` : `D-${dd.diff}`}
                      </div>
                      <div className="text-[9px] text-gray-400 mt-0.5">목표월 {dd.label}</div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* 액션 3종 카드 */}
            <div className="px-6 py-4 border-b border-[#E7EAF0] space-y-2 shrink-0">
              {[
                { icon: ClipboardList, color: "bg-blue-50 text-blue-600", label: "지난번 액션", date: activity[1]?.date, text: activity[1]?.text, field: "prevAction", editable: !!activity[1] },
                { icon: PlayCircle, color: "bg-navy/10 text-navy", label: "현재 액션", date: activity[0]?.date, text: activity[0]?.text, field: "currentAction", editable: !!activity[0] },
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
                            <button className="text-[10px] text-navy underline" onClick={() => startEdit(row.field, row.text)}>수정</button>
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
            <div className="flex border-b border-[#E7EAF0] shrink-0 px-2">
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
                    (detailTab === t.key ? "text-navy border-navy" : "text-gray-400 border-transparent")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {detailTab === "info" && (
                <>
                  <div className="grid grid-cols-2 gap-px bg-[#E7EAF0] border-b border-[#E7EAF0]">
                    {[
                      [User, "담당자", selected.contactPerson || "-"],
                      [Users, "RM / SO", [selected.rm, selected.so].filter(Boolean).join(" / ") || "-"],
                      [TrendingUp, "기대실적", formatWon(selected.expectedPerformance)],
                      [Wallet, "계약금액", formatWon(selected.contractAmount)],
                      [CalendarClock, "계약목표", selected.contractGoal || "-"],
                      [Layers, "진행단계", selected.stage || "-"],
                    ].map(([Icon, label, value]) => (
                      <div key={label} className="bg-white px-4 py-3">
                        <div className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1">
                          <Icon className="w-3 h-3" />{label}
                        </div>
                        <div className="text-xs font-semibold text-navy break-words">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="px-6 py-3 border-b border-[#E7EAF0]">
                    <div className="text-[10px] text-gray-400 mb-1 flex items-center gap-1"><Percent className="w-3 h-3" />계약가능성</div>
                    <span className={probPillClass(selected.probability)}>{selected.probability || "가능성 미상"}</span>
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
                        <button className="text-[10px] text-navy underline" onClick={() => setEditingField("meeting")}>수정</button>
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
                      <div className="text-xs font-extrabold text-navy">주요 히스토리 (최근 3건)</div>
                      <button className="text-[10px] text-navy" onClick={() => setDetailTab("history")}>전체보기 ›</button>
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
                  <div className="text-xs font-extrabold text-navy mb-3">액션 히스토리 ({activity.length})</div>
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
                  <div className="text-xs font-extrabold text-navy mb-3">관련파일 ({(selected.relatedFiles || []).length})</div>
                  <div className="space-y-1.5">
                    {(selected.relatedFiles || []).map((f, i) => {
                      const label = typeof f === "string" ? f : f.label;
                      const url = typeof f === "string" ? null : f.url;
                      const content = (
                        <div className="text-xs text-gray-700 bg-[#F8FAFC] hover:bg-[#EEF2F7] rounded-lg px-3 py-2 break-words flex items-center gap-2">
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
                  <div className="text-[10px] text-gray-300 mt-3">※ 더존 사내 그룹웨어 링크라 로그인된 상태에서만 열립니다.</div>
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
                        <div className="text-xs font-extrabold text-navy mb-2">같은 회사 (다른 부서·담당)</div>
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
                    <div className="text-xs font-extrabold text-navy mb-2">같은 구분 ({mapGroupName(selected.orgGroup)})</div>
                    <div className="space-y-1.5">
                      {(groupCards.find((g) => g.name === mapGroupName(selected.orgGroup))?.allOrgs || [])
                        .filter((o) => o.name !== selected.orgName)
                        .map((o) => (
                          <div
                            key={o.name}
                            onClick={() => openDeal(o.deal)}
                            className="flex items-center text-xs bg-[#F8FAFC] hover:bg-[#EEF2F7] rounded-lg px-3 py-2 cursor-pointer"
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

      {showNewDeal && (
        <>
          <div className="fixed inset-0 bg-navy-deep/40 z-50" onClick={() => setShowNewDeal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 pointer-events-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-extrabold text-navy">새 딜 등록</h3>
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
