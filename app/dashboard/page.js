'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, query, where, doc, getDoc, updateDoc, addDoc, arrayUnion, arrayRemove, deleteDoc, setDoc, writeBatch, serverTimestamp } from "firebase/firestore";
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
  Sun, Moon, Sparkles, UserCheck, Newspaper, BookOpen, ExternalLink, Menu,
  Pencil, Trash2, Check, Copy, Printer,
} from "lucide-react";

function matchesSearch(text, query) {
  if (!query) return true;
  return (text || "").toLowerCase().includes(query.trim().toLowerCase());
}

function renderInlineMd(line, keyPrefix) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

// 미팅 사전 보고서 전용 렌더러. 화면/다크모드와 무관하게 항상 흰 배경의
// "레터헤드 문서"로 보이도록 라이트 톤으로 고정하고, 인쇄 시 섹션 제목이
// 내용과 분리되어 페이지가 끊기지 않도록 break-after/break-inside를 지정한다.
function renderBriefMarkdown(md) {
  if (!md) return null;
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let listBuf = [];
  const flushList = () => {
    if (listBuf.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-none pl-0 space-y-1.5 mb-3.5">
          {listBuf.map((item, i) => (
            <li key={i} className="text-[11.5px] text-[#374151] leading-relaxed flex gap-2">
              <span className="text-navy font-bold shrink-0">·</span>
              <span>{renderInlineMd(item, `li-${blocks.length}-${i}`)}</span>
            </li>
          ))}
        </ul>
      );
      listBuf = [];
    }
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) { flushList(); return; }

    if (trimmed.startsWith("# ")) {
      flushList();
      blocks.push(
        <h1 key={idx} className="text-[15px] font-extrabold text-navy mt-1 mb-3" style={{ breakAfter: "avoid" }}>
          {trimmed.slice(2)}
        </h1>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList();
      blocks.push(
        <h2
          key={idx}
          className="text-[13px] font-extrabold text-navy mt-6 mb-2.5 pb-2 border-b-2 border-[#E7EAF0] flex items-center gap-1.5 first:mt-0"
          style={{ breakAfter: "avoid", breakInside: "avoid" }}
        >
          <span className="w-1.5 h-3.5 bg-navy inline-block rounded-sm shrink-0" />
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith("### ")) {
      flushList();
      blocks.push(
        <h3 key={idx} className="text-[11.5px] font-bold text-gray-500 mt-3 mb-1.5" style={{ breakAfter: "avoid" }}>
          {trimmed.slice(4)}
        </h3>
      );
    } else if (/^[-*]\s+/.test(trimmed)) {
      listBuf.push(trimmed.replace(/^[-*]\s+/, ""));
    } else if (/^".*"$/.test(trimmed)) {
      flushList();
      blocks.push(
        <div
          key={idx}
          className="mt-3 mb-3.5 text-[11.5px] font-bold text-navy bg-[#F0F4FA] rounded-lg px-3.5 py-2.5 border-l-[3px] border-navy"
          style={{ breakInside: "avoid" }}
        >
          {trimmed}
        </div>
      );
    } else {
      flushList();
      blocks.push(<p key={idx} className="text-[11.5px] text-[#374151] leading-relaxed mb-2">{renderInlineMd(trimmed, `p-${idx}`)}</p>);
    }
  });
  flushList();
  return blocks;
}

function formatReportDate(d) {
  if (!d) return "-";
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${days[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

function todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntilDate(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00");
  if (isNaN(target)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

const CONTRACT_MGMT_EXCLUDE = [
  { org: "중진공", product: "네트워크론" },
  { org: "신한은행", product: "팩토링" },
  { org: "중진공", product: "팩토링" },
  { org: "한국수출입은행", product: "디지털공급망팩토링" },
];

function renewalStatusInfo(days) {
  if (days === null) return { label: "미설정", cls: "bg-gray-100 text-gray-500" };
  if (days < 0) return { label: "만료", cls: "bg-gray-800 text-white" };
  if (days <= 14) return { label: "긴급확인", cls: "bg-red-100 text-red-600" };
  if (days <= 30) return { label: "우선확인", cls: "bg-orange-100 text-orange-600" };
  if (days <= 45) return { label: "갱신검토", cls: "bg-amber-100 text-amber-700" };
  if (days <= 60) return { label: "알림예정", cls: "bg-blue-100 text-blue-600" };
  return { label: "정상", cls: "bg-green-100 text-green-600" };
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
  "KB국민은행": "kbstar.com", "KB국민카드": "kbcard.com",
  "KB캐피탈": "kbcapital.com", "신한은행": "shinhan.com", "신한카드": "shinhancard.com",
  "신한캐피탈": "shinhancapital.com", "신한투자증권": "shinhansec.com", "신한SOL증권": "shinhansec.com",
  "신한지주": "shinhangroup.com", "신한저축은행": "shinhansavings.com", "MG캐피탈": "mgcap.co.kr",
  "하나은행": "hanabank.com", "하나카드": "hanacard.co.kr",
  "하나캐피탈": "hanacapital.co.kr", "우리은행": "wooribank.com", "우리카드": "wooricard.com",
  "NH농협은행": "nonghyup.com", "NH농협캐피탈": "nhcapital.co.kr", "NH카드": "card.nonghyup.com",
  "IBK기업은행": "ibk.co.kr", "IM뱅크": "imbank.co.kr",
  "부산은행": "busanbank.co.kr", "제주은행": "jejubank.co.kr", "수협은행": "suhyup-bank.com",
  "카카오뱅크": "kakaobank.com", "토스뱅크": "tossbank.com",
  "비바리퍼블리카": "toss.im", "토스페이먼츠": "tosspayments.com",
  "케이뱅크": "kbanknow.com",
  "KCB": "koreacb.com", "나이스평가정보": "nice.co.kr", "SGI서울보증": "sgic.co.kr",
  "신용보증기금": "kodit.co.kr", "더존": "douzone.com", "더존비즈온": "douzone.com",
  "전자신문사": "etnews.com", "한국수출입은행": "koreaexim.go.kr", "리드코프": "leadcorp.co.kr",
  "BNK캐피탈": "bnkcapital.co.kr", "중진공": "kosmes.or.kr",
  "롯데카드": "lottecard.co.kr", "롯데캐피탈": "lottecap.com",
  "애큐온캐피탈": "acuoncapital.com", "애큐온저축은행": "acuonsb.co.kr",
  "저축은행중앙회": "fsb.or.kr", "JB우리캐피탈": "wooricap.com",
  "한국투자저축은행": "sb.koreainvestment.com",
};

// 자동으로 가져오는 img.logo.dev 결과가 실제 브랜드 로고와 다른 경우를 대비해
// 직접 등록한 로고 이미지가 있으면 우선 사용한다.
const LOGO_IMAGES = {
  "신한캐피탈": "/logos/shinhan-capital.png",
  "신한투자증권": "/logos/shinhan-sol-securities.png",
  "신한SOL증권": "/logos/shinhan-sol-securities.png",
  "신한저축은행": "/logos/shinhan-savings.png",
  "저축은행중앙회": "/logos/savings-bank-federation.png",
  "KB캐피탈": "/logos/kb-capital.png",
  "MG캐피탈": "/logos/mg-capital.png",
};

function LogoBadge({ name }) {
  const key = (name || "").trim();
  const customSrc = LOGO_IMAGES[key];
  const domain = LOGO_DOMAINS[key];
  const [broken, setBroken] = useState(false);
  if (!broken) {
    const src = customSrc || (domain ? `https://img.logo.dev/${domain}?token=pk_dj9Yvu0VRguqwmAbY-tGzg&size=64&format=png&fallback=404` : null);
    if (src) {
      return (
        <img
          src={src}
          alt=""
          onError={() => setBroken(true)}
          className="w-[22px] h-[22px] rounded-[5px] mr-1.5 inline-block align-middle object-contain bg-white"
        />
      );
    }
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

function DonutLegendRow({ color, label, value, onClick }) {
  return (
    <div className={"flex items-center gap-2 " + (onClick ? "cursor-pointer hover:opacity-70" : "")} onClick={onClick}>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
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
        <div className="text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">{value || "미입력"}</div>
      ) : (
        <div className="mt-1 space-y-1.5">
          {multiline ? (
            <textarea
              className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs"
              rows={3}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
          ) : (
            <input
              className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs"
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
  { key: "dropped", color: "text-gray-500", bg: "bg-gray-100", ring: "ring-gray-400", icon: X, label: "드랍 기업", meta: "제외됨" },
];

const RECENCY_LABEL = {
  active7: ["활발 진행", "text-green-600 bg-green-50"],
  followUp: ["후속 필요", "text-blue-600 bg-blue-50"],
  stale: ["장기 정체", "text-red-600 bg-red-50"],
  completed: ["계약 완료", "text-navy bg-blue-100"],
  dropped: ["드랍", "text-gray-500 bg-gray-100"],
};

const MEETING_PURPOSE_OPTIONS = [
  { key: "first", label: "첫 미팅 준비" },
  { key: "followup", label: "후속 미팅 준비" },
  { key: "proposal", label: "제품 제안 미팅" },
  { key: "poc", label: "PoC 협의" },
  { key: "contract", label: "계약/예산 협의" },
  { key: "reactivate", label: "관계 재활성화" },
];

const SHORTCUT_LINKS = [
  { label: "경쟁사 다이제스트", url: "https://daily-digest-techfinratings.netlify.app/", icon: Newspaper },
  { label: "세일즈 대시보드", url: "https://techfin-sales-kpi.vercel.app/", icon: BarChart3 },
  { label: "세일즈 매뉴얼", url: "https://techfinsalesmanual.vercel.app/", icon: BookOpen },
];

const NAV_ITEMS = [
  { key: "dashboard", label: "대시보드", icon: LayoutDashboard },
  { key: "mycompanies", label: "업체현황", icon: UserCheck },
  { key: "contracts", label: "계약관리", icon: Handshake },
  { key: "meetingPrep", label: "기업상세", icon: Sparkles },
  { key: "report", label: "리포트", icon: BarChart3 },
  { key: "settings", label: "설정", icon: Settings },
];

export default function Dashboard() {
  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [kakaoworkEmailInput, setKakaoworkEmailInput] = useState("");
  const [savingKakaoworkEmail, setSavingKakaoworkEmail] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModalKey, setProfileModalKey] = useState(null);
  const [reportModal, setReportModal] = useState(null);
  const [deals, setDeals] = useState([]);
  const [droppedOrgNames, setDroppedOrgNames] = useState(new Set());
  const [allActivity, setAllActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [groupViewMode, setGroupViewMode] = useState("card");
  const [listFilterGroup, setListFilterGroup] = useState("전체");
  const [listFilterRecency, setListFilterRecency] = useState("전체");
  const [myCompaniesFilter, setMyCompaniesFilter] = useState("all");
  const [darkMode, setDarkMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState("전체");
  const [activeKpi, setActiveKpi] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loadError, setLoadError] = useState("");

  const [meetingPrepSearch, setMeetingPrepSearch] = useState("");
  const [meetingPrepOrg, setMeetingPrepOrg] = useState("");
  const [meetingPrepPurpose, setMeetingPrepPurpose] = useState("first");
  const [meetingPrepFreeText, setMeetingPrepFreeText] = useState("");
  const [meetingPrepLoading, setMeetingPrepLoading] = useState(false);
  const [meetingPrepReport, setMeetingPrepReport] = useState("");
  const [meetingPrepReportAt, setMeetingPrepReportAt] = useState(null);
  const [meetingPrepError, setMeetingPrepError] = useState("");
  const [meetingPrepNews, setMeetingPrepNews] = useState([]);
  const [meetingPrepNewsLoading, setMeetingPrepNewsLoading] = useState(false);

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
  const [newDealCustomProduct, setNewDealCustomProduct] = useState(false);

  const [nlText, setNlText] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlResult, setNlResult] = useState(null);
  const [nlCompanySearch, setNlCompanySearch] = useState("");
  const [nlSelectedOrg, setNlSelectedOrg] = useState("");
  const [nlOverrideDealId, setNlOverrideDealId] = useState("");
  const [nlDealAutoGuessed, setNlDealAutoGuessed] = useState(false);
  const [nlDate, setNlDate] = useState("");
  const [nlActionText, setNlActionText] = useState("");
  const [nlApplyActivity, setNlApplyActivity] = useState(true);
  const [nlApplyMeeting, setNlApplyMeeting] = useState(false);
  const [nlFieldSuggestions, setNlFieldSuggestions] = useState([]);
  const [nlApplyFields, setNlApplyFields] = useState({});
  const [nlRelatedFileUrl, setNlRelatedFileUrl] = useState("");
  const [nlRelatedFileLabel, setNlRelatedFileLabel] = useState("");
  const [nlApplyRelatedFile, setNlApplyRelatedFile] = useState(false);
  const [nlMeetingDate, setNlMeetingDate] = useState("");
  const [nlMeetingNote, setNlMeetingNote] = useState("");
  const [nlSaving, setNlSaving] = useState(false);
  const [nlError, setNlError] = useState("");
  const [nlHistoryOpen, setNlHistoryOpen] = useState(false);
  const [nlConfirmDeleteId, setNlConfirmDeleteId] = useState(null);
  const [detailTab, setDetailTab] = useState("info");
  const [notifOpen, setNotifOpen] = useState(false);
  const [kpiModalKey, setKpiModalKey] = useState(null);
  const [showDroppedModal, setShowDroppedModal] = useState(false);
  const [editNextActionDate, setEditNextActionDate] = useState("");
  const [editActivityDate, setEditActivityDate] = useState("");
  const [showMemoHistory, setShowMemoHistory] = useState(false);
  const [confirmDropCompany, setConfirmDropCompany] = useState(false);
  const [contractTab, setContractTab] = useState("all");
  const [contractKpiModal, setContractKpiModal] = useState(null);
  const [groupRecencyModal, setGroupRecencyModal] = useState(null);

  const [quoteEditMode, setQuoteEditMode] = useState(false);
  const [editedQuoteHtml, setEditedQuoteHtml] = useState(null);
  const quotePrintRef = useRef(null);

  const [quote, setQuote] = useState(() => {
    const start = new Date();
    const until = new Date();
    until.setDate(until.getDate() + 30);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      customerName: "",
      contactName: "",
      email: "",
      quoteDate: fmt(start),
      validUntil: fmt(until),
      products: [
        { key: "monitoring", name: "기업모니터링 서비스", desc: "기업의 주요 이슈와 변화를 모니터링하는 서비스입니다.", features: ["실시간 이슈 모니터링", "맞춤형 리포트 제공", "담당자 알림 서비스"], selected: true, plan: "pro", standardPrice: 1000000, proPrice: 1500000 },
        { key: "dbSearch", name: "기업DB조회플랫폼 서비스", desc: "국내 기업 데이터 조회 및 분석 플랫폼입니다.", features: ["국내 기업 데이터 무제한 조회", "상세 재무/비재무 데이터", "API 연동 지원"], selected: true, plan: "pro", standardPrice: 800000, proPrice: 1200000 },
      ],
      discountRate: 33,
      contractMonths: 12,
      vatIncluded: true,
      policies: [
        { label: "서비스 이용 약관에 동의합니다.", checked: true },
        { label: "개인정보 수집 및 이용에 동의합니다.", checked: true },
        { label: "별도 계약서 체결이 필요합니다.", checked: false },
      ],
      memo: "",
    };
  });

  const quoteCalc = useMemo(() => {
    const selected = quote.products.filter((p) => p.selected);
    const listTotal = selected.reduce((a, p) => a + (p.plan === "pro" ? p.proPrice : p.standardPrice), 0);
    const finalMonthly = Math.round(listTotal * (1 - (quote.discountRate || 0) / 100));
    const annual = finalMonthly * quote.contractMonths;
    const discountAnnual = (listTotal - finalMonthly) * quote.contractMonths;
    return { selected, listTotal, finalMonthly, annual, discountAnnual };
  }, [quote]);

  const quoteNumber = "CV-" + (quote.quoteDate || "").replace(/-/g, "") + "-001";

  function enterQuoteEditMode() {
    if (editedQuoteHtml === null && quotePrintRef.current) {
      setEditedQuoteHtml(quotePrintRef.current.innerHTML);
    }
    setQuoteEditMode(true);
  }
  function exitQuoteEditMode() {
    if (quotePrintRef.current) setEditedQuoteHtml(quotePrintRef.current.innerHTML);
    setQuoteEditMode(false);
  }
  function resetQuoteToAuto() {
    setEditedQuoteHtml(null);
    setQuoteEditMode(false);
  }
  function quoteExec(cmd, value) {
    quotePrintRef.current?.focus();
    document.execCommand(cmd, false, value);
  }
  function quoteInsertHtml(html) {
    quotePrintRef.current?.focus();
    document.execCommand("insertHTML", false, html);
  }
  function quoteInsertTable() {
    quoteInsertHtml(
      '<table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:11px" border="1">' +
      '<tr><td style="padding:6px;border:1px solid #ccc">항목1</td><td style="padding:6px;border:1px solid #ccc">항목2</td></tr>' +
      '<tr><td style="padding:6px;border:1px solid #ccc">항목3</td><td style="padding:6px;border:1px solid #ccc">항목4</td></tr>' +
      "</table>"
    );
  }
  function quoteInsertShape(shape) {
    const style = shape === "circle"
      ? "display:inline-block;width:80px;height:80px;background:#EAF1FF;border:1px solid #0D1F4E;border-radius:50%;margin:4px;vertical-align:middle;"
      : "display:inline-block;width:120px;height:60px;background:#EAF1FF;border:1px solid #0D1F4E;margin:4px;vertical-align:middle;";
    quoteInsertHtml(`<div style="${style}"></div>`);
  }
  function quoteInsertLine() {
    quoteInsertHtml('<hr style="border:none;border-top:1px solid #ccc;margin:10px 0;">');
  }
  function quoteInsertText() {
    quoteInsertHtml('<div style="display:inline-block;min-width:100px;padding:4px;border:1px dashed #9CA3AF;margin:4px;">새 텍스트</div>');
  }
  function quoteInsertImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      quoteInsertHtml(`<img src="${reader.result}" style="max-width:200px;display:block;margin:8px 0;">`);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }
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
          setKakaoworkEmailInput(snap.data().kakaoworkEmail || "");
        }
      } catch (e) {}
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    (async () => {
      try {
        const [dealsSnap, activitySnap, droppedSnap] = await Promise.all([
          getDocs(collection(db, "deals")),
          getDocs(collection(db, "activityLog")),
          getDocs(collection(db, "droppedCompanies")),
        ]);
        setDeals(dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setAllActivity(activitySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDroppedOrgNames(new Set(droppedSnap.docs.map((d) => d.id)));
      } catch (e) {
        setLoadError(String(e && e.message ? e.message : e));
      } finally {
        setLoading(false);
      }
    })();
  }, [authChecked]);

  // "다음 액션"의 실행 예정일(nextActionDate)이 당일(또는 지난 날짜)에 도달하면,
  // 그 내용을 액션 히스토리(activityLog)에 새 항목으로 추가해 "현재 액션"으로 승격시키고
  // (기존 "현재 액션"은 자동으로 "지난번 액션" → 히스토리로 밀려남), "다음 액션"은 비운다.
  useEffect(() => {
    if (loading || !deals.length) return;
    const todayStr = todayLocalStr();
    const due = deals.filter(
      (d) => d.nextAction && d.nextAction.trim() && d.nextActionDate && d.nextActionDate <= todayStr
    );
    if (due.length === 0) return;
    (async () => {
      try {
        const batch = writeBatch(db);
        const newActivityEntries = [];
        due.forEach((d) => {
          const activityRef = doc(collection(db, "activityLog"));
          batch.set(activityRef, {
            dealId: d.id,
            date: d.nextActionDate,
            text: d.nextAction,
            source: "next-action-auto",
            createdAt: serverTimestamp(),
          });
          newActivityEntries.push({ id: activityRef.id, dealId: d.id, date: d.nextActionDate, text: d.nextAction, source: "next-action-auto" });
          batch.update(doc(db, "deals", d.id), { nextAction: "", nextActionDate: "", updatedAt: serverTimestamp() });
        });
        await batch.commit();
        setAllActivity((prev) => [...prev, ...newActivityEntries]);
        setDeals((prev) =>
          prev.map((d) => (due.some((x) => x.id === d.id) ? { ...d, nextAction: "", nextActionDate: "" } : d))
        );
        setActivity((prev) => {
          if (!selected || !due.some((x) => x.id === selected.id)) return prev;
          const added = newActivityEntries.filter((a) => a.dealId === selected.id);
          return [...added, ...prev].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        });
        setSelected((prev) => (prev && due.some((x) => x.id === prev.id) ? { ...prev, nextAction: "", nextActionDate: "" } : prev));
      } catch (e) {
        console.error("다음 액션 자동 전환 실패", e);
      }
    })();
  }, [loading, deals]);

  useEffect(() => {
    if (!selected) return;
    setEditingField(null);
    setEditMeetingDate(selected.nextMeetingDate || "");
    setEditMeetingNote(selected.nextMeetingNote || "");
    setActiveProductCat(classifyTargetProduct(selected.targetProduct));
  }, [selected]);

  const activeDeals = useMemo(() => {
    return deals.filter((d) => !droppedOrgNames.has((d.orgName || "").trim()));
  }, [deals, droppedOrgNames]);

  const droppedCompanyList = useMemo(() => {
    const map = {};
    deals.forEach((d) => {
      const name = (d.orgName || "").trim();
      if (!name || !droppedOrgNames.has(name)) return;
      if (!map[name]) map[name] = { name, group: mapGroupName(d.orgGroup), deals: [] };
      map[name].deals.push(d);
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [deals, droppedOrgNames]);

  async function dropCompany(orgName) {
    const name = (orgName || "").trim();
    if (!name) return;
    try {
      await setDoc(doc(db, "droppedCompanies", name), { droppedAt: serverTimestamp(), droppedBy: profile?.name || null });
      setDroppedOrgNames((prev) => new Set([...prev, name]));

      // 해당 업체의 모든 딜 계약가능성을 명시적으로 "드랍"으로 일괄 변경
      const matchingDeals = deals.filter((d) => (d.orgName || "").trim() === name);
      if (matchingDeals.length > 0) {
        const batch = writeBatch(db);
        matchingDeals.forEach((d) => batch.update(doc(db, "deals", d.id), { probability: "드랍" }));
        await batch.commit();
        setDeals((prev) => prev.map((d) => ((d.orgName || "").trim() === name ? { ...d, probability: "드랍" } : d)));
      }
    } catch (e) {
      alert("삭제 실패: " + (e.message || e));
    }
  }

  async function restoreCompany(orgName) {
    const name = (orgName || "").trim();
    try {
      await deleteDoc(doc(db, "droppedCompanies", name));
      setDroppedOrgNames((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    } catch (e) {
      alert("복구 실패: " + (e.message || e));
    }
  }

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
    const todayLocal = new Date();
    todayLocal.setHours(0, 0, 0, 0);
    const daysUntil = (dateStr) => {
      if (!dateStr) return null;
      const target = new Date(dateStr + "T00:00:00");
      if (isNaN(target)) return null;
      return Math.round((target - todayLocal) / 86400000);
    };
    const map = {};
    activeDeals.forEach((d) => {
      const lastDate = lastActionByDeal[d.id];
      let recency;
      if (d.probability === "완료") {
        recency = "completed";
      } else if (d.probability === "드랍") {
        // 계약가능성을 명시적으로 "드랍"으로 표시한 딜은 활발진행/후속필요/장기정체 집계에서 제외
        recency = "dropped";
      } else {
        if (lastDate) {
          const diffDays = Math.floor((now - new Date(lastDate)) / 86400000);
          recency = diffDays <= 7 ? "active7" : diffDays <= 30 ? "followUp" : "stale";
        } else {
          recency = "stale";
        }
        // 다음 액션이 입력되어 있으면 "후속 필요"로 분류한다. 단, 이미 "활발 진행"인 딜은 그대로 둔다.
        if (d.nextAction && d.nextAction.trim() && recency !== "active7") {
          recency = "followUp";
        }
      }
      let future = null;
      let futureReason = null;
      let futureDate = null;
      if (d.nextMeetingDate) {
        const diffFuture = daysUntil(d.nextMeetingDate);
        if (diffFuture !== null && diffFuture >= 0 && diffFuture <= 7) { future = "actionDue"; futureReason = "meeting"; futureDate = d.nextMeetingDate; }
        else if (diffFuture !== null && diffFuture > 7) { future = "actionPlanned"; futureReason = "meeting"; futureDate = d.nextMeetingDate; }
      }
      if (d.nextActionDate) {
        const diffAction = daysUntil(d.nextActionDate);
        let actionCat = null;
        if (diffAction !== null && diffAction >= 0 && diffAction <= 7) actionCat = "actionDue";
        else if (diffAction !== null && diffAction > 7) actionCat = "actionPlanned";
        if (actionCat) {
          if (!future || (actionCat === "actionDue" && future !== "actionDue") || (actionCat === future && diffAction < daysUntil(futureDate))) {
            future = actionCat;
            futureReason = "nextAction";
            futureDate = d.nextActionDate;
          }
        }
      }
      if (d.contractRenewalDate) {
        const diffRenewal = daysUntil(d.contractRenewalDate);
        let renewalCat = null;
        if (diffRenewal !== null && diffRenewal >= 0 && diffRenewal <= 30) renewalCat = "actionDue";
        else if (diffRenewal !== null && diffRenewal > 30 && diffRenewal <= 60) renewalCat = "actionPlanned";
        if (renewalCat) {
          // 갱신 임박이 더 급하면(actionDue) 우선, 같은 등급이면 더 이른 날짜 우선
          if (!future || (renewalCat === "actionDue" && future !== "actionDue") || (renewalCat === future && diffRenewal < daysUntil(futureDate))) {
            future = renewalCat;
            futureReason = "renewal";
            futureDate = d.contractRenewalDate;
          }
        }
      }
      map[d.id] = { recency, future, futureReason, futureDate };
    });
    return map;
  }, [activeDeals, lastActionByDeal]);

  const filtered = useMemo(() => {
    return activeDeals.filter((d) => {
      const g = mapGroupName(d.orgGroup);
      if (activeGroup !== "전체" && g !== activeGroup) return false;
      if (search && !matchesSearch(d.orgName, search)) return false;
      if (activeKpi) {
        const cat = dealKpiCat[d.id] || {};
        if (cat.recency !== activeKpi && cat.future !== activeKpi) return false;
      }
      return true;
    });
  }, [activeDeals, activeGroup, search, activeKpi, dealKpiCat]);

  const kpis = useMemo(() => {
    let active7 = 0, followUp = 0, stale = 0, actionDue = 0, actionPlanned = 0;
    Object.values(dealKpiCat).forEach((c) => {
      if (c.recency === "active7") active7++;
      else if (c.recency === "followUp") followUp++;
      else if (c.recency === "stale") stale++;
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
    activeDeals.forEach((d) => {
      const g = mapGroupName(d.orgGroup);
      if (!map[g]) map[g] = { name: g, orgs: new Set(), progress: 0, due: 0, delayed: 0, done: 0, active7: 0, followUp: 0, stale: 0, completed: 0, dropped: 0, orgReps: {}, expected: 0, contract: 0 };
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
    const counts = { 상: 0, 중: 0, 하: 0, 완료: 0, 드랍: 0 };
    activeDeals.forEach((d) => {
      const p = d.probability;
      if (p && counts[p] !== undefined) counts[p]++;
      else counts["드랍"]++;
    });
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [activeDeals]);

  const probSummary = useMemo(() => {
    const isFinal = (p) => p === "완료";
    const isQuote = (p) => ["상", "중", "하"].includes(p);
    const uniqOrgs = (list) => new Set(list.map((d) => (d.orgName || "").trim())).size;

    const quoteRows = ["상", "중", "하"].map((lvl) => {
      const list = activeDeals.filter((d) => d.probability === lvl);
      return { key: lvl, label: lvl, count: list.length, orgCount: uniqOrgs(list), amount: list.reduce((a, d) => a + (d.expectedPerformance || 0), 0) };
    });
    const quoteAll = activeDeals.filter((d) => isQuote(d.probability));
    const contractAll = activeDeals.filter((d) => isFinal(d.probability));
    // 드랍 카드는 실제로 "기업 드랍" 처리된 기업만 집계 (전체 deals 기준, activeDeals 아님)
    // 드랍 카드 = 기업 전체가 드랍 처리된 곳 + 개별 딜의 계약가능성을 드랍으로 표시한 것 (중복 제거)
    const dropIds = new Set();
    const dropAll = [];
    deals.forEach((d) => {
      const isCompanyDropped = droppedOrgNames.has((d.orgName || "").trim());
      const isDealDropped = d.probability === "드랍";
      if ((isCompanyDropped || isDealDropped) && !dropIds.has(d.id)) {
        dropIds.add(d.id);
        dropAll.push(d);
      }
    });

    return {
      quote: {
        rows: quoteRows,
        totalCount: quoteAll.length,
        totalOrgCount: uniqOrgs(quoteAll),
        totalAmount: quoteAll.reduce((a, d) => a + (d.expectedPerformance || 0), 0),
      },
      contract: {
        totalCount: contractAll.length,
        totalOrgCount: uniqOrgs(contractAll),
        totalAmount: contractAll.reduce((a, d) => a + (d.contractAmount || 0), 0),
      },
      drop: {
        totalCount: dropAll.length,
        totalOrgCount: uniqOrgs(dropAll),
        totalAmount: dropAll.reduce((a, d) => a + (d.expectedPerformance || 0), 0),
      },
    };
  }, [activeDeals, deals, droppedOrgNames]);

  function formatEok(won) {
    return (Math.round((won || 0) / 1e8 * 10) / 10) + "억원";
  }

  const renewalUpcomingDeals = useMemo(() => {
    return activeDeals
      .filter((d) => d.probability === "완료")
      .map((d) => ({ ...d, _daysLeft: daysUntilDate(d.contractRenewalDate) }))
      .filter((d) => d._daysLeft !== null && d._daysLeft >= 0 && d._daysLeft <= 60)
      .sort((a, b) => a._daysLeft - b._daysLeft);
  }, [activeDeals]);

  const contractRenewalList = useMemo(() => {
    return activeDeals
      .filter((d) => d.probability === "완료")
      .filter((d) => !CONTRACT_MGMT_EXCLUDE.some((ex) => ex.org === (d.orgName || "").trim() && ex.product === (d.targetProduct || "").replace(/\n/g, "")))
      .map((d) => {
        const days = daysUntilDate(d.contractRenewalDate);
        return { ...d, _daysLeft: days, _status: renewalStatusInfo(days) };
      })
      .sort((a, b) => {
        if (a._daysLeft === null) return 1;
        if (b._daysLeft === null) return -1;
        return a._daysLeft - b._daysLeft;
      });
  }, [activeDeals]);

  const contractKpis = useMemo(() => {
    const total = contractRenewalList.length;
    const within30 = contractRenewalList.filter((d) => d._daysLeft !== null && d._daysLeft >= 0 && d._daysLeft <= 30).length;
    const within60 = contractRenewalList.filter((d) => d._daysLeft !== null && d._daysLeft > 30 && d._daysLeft <= 60).length;
    const thisMonth = todayLocalStr().slice(0, 7);
    const thisMonthAmount = contractRenewalList
      .filter((d) => (d.contractRenewalDate || "").slice(0, 7) === thisMonth)
      .reduce((a, d) => a + (d.contractAmount || 0), 0);
    return { total, within60, within30, thisMonthAmount };
  }, [contractRenewalList]);

  const monthlyActivity = useMemo(() => {
    const map = {};
    const currentYm = todayLocalStr().slice(0, 7);
    allActivity.forEach((a) => {
      if (!a.date) return;
      const ym = a.date.slice(0, 7);
      if (ym > currentYm) return;
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

  async function handleSaveKakaoworkEmail() {
    if (!auth.currentUser) return;
    setSavingKakaoworkEmail(true);
    try {
      await updateDoc(doc(db, "users", auth.currentUser.uid), { kakaoworkEmail: kakaoworkEmailInput.trim() });
      setProfile((prev) => ({ ...prev, kakaoworkEmail: kakaoworkEmailInput.trim() }));
    } catch (e) {
      alert("저장 실패: " + (e.message || e));
    } finally {
      setSavingKakaoworkEmail(false);
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
    return activeDeals
      .filter((d) => (d.rm === profile.name || d.so === profile.name))
      .filter((d) => ["actionDue", "actionPlanned"].includes(dealKpiCat[d.id]?.future))
      .sort((a, b) => (lastActionByDeal[b.id] || "").localeCompare(lastActionByDeal[a.id] || ""));
  }, [activeDeals, dealKpiCat, profile, lastActionByDeal]);

  const companyRows = useMemo(() => {
    const map = {};
    activeDeals.forEach((d) => {
      const name = (d.orgName || "").trim();
      if (!name) return;
      if (!map[name]) map[name] = { name, group: mapGroupName(d.orgGroup), deals: [], active7: 0, followUp: 0, stale: 0, completed: 0, dropped: 0 };
      map[name].deals.push(d);
      const recency = dealKpiCat[d.id]?.recency;
      if (recency) map[name][recency]++;
    });
    return Object.values(map)
      .map((o) => {
        const counts = { "Raw Data": 0, "플랫폼": 0, "기타": 0 };
        o.deals.forEach((d) => counts[classifyTargetProduct(d.targetProduct)]++);
        const totalExpected = o.deals.reduce((a, d) => a + (d.expectedPerformance || 0), 0);
        const dominant = o.stale > 0 ? "stale" : o.followUp > 0 ? "followUp" : o.active7 > 0 ? "active7" : o.completed > 0 ? "completed" : "dropped";
        return { ...o, counts, totalCount: o.deals.length, totalExpected, dominant };
      })
      .sort((a, b) => b.totalCount - a.totalCount);
  }, [activeDeals, dealKpiCat]);

  const meetingPrepMatches = useMemo(() => {
    if (!meetingPrepSearch.trim()) return [];
    return companyRows.filter((o) => matchesSearch(o.name, meetingPrepSearch)).slice(0, 8);
  }, [meetingPrepSearch, companyRows]);

  const meetingPrepDeals = useMemo(() => {
    if (!meetingPrepOrg) return [];
    return activeDeals.filter((d) => (d.orgName || "").trim() === meetingPrepOrg);
  }, [activeDeals, meetingPrepOrg]);

  const meetingPrepActivity = useMemo(() => {
    const dealIds = new Set(meetingPrepDeals.map((d) => d.id));
    return allActivity
      .filter((a) => dealIds.has(a.dealId))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [allActivity, meetingPrepDeals]);

  const meetingPrepNextMeeting = useMemo(() => {
    return meetingPrepDeals
      .filter((d) => d.nextMeetingDate)
      .sort((a, b) => (a.nextMeetingDate || "").localeCompare(b.nextMeetingDate || ""))[0] || null;
  }, [meetingPrepDeals]);

  const meetingPrepDealById = useMemo(() => {
    const map = {};
    meetingPrepDeals.forEach((d) => { map[d.id] = d; });
    return map;
  }, [meetingPrepDeals]);

  const meetingPrepLastContact = useMemo(() => {
    const dates = meetingPrepDeals.map((d) => lastActionByDeal[d.id]).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [meetingPrepDeals, lastActionByDeal]);

  async function handleGenerateMeetingBrief() {
    if (!meetingPrepOrg) return;
    setMeetingPrepLoading(true);
    setMeetingPrepError("");
    setMeetingPrepReport(""); setMeetingPrepReportAt(null);
    try {
      const res = await fetch("/api/meeting-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: meetingPrepOrg,
          purpose: meetingPrepPurpose,
          freeText: meetingPrepFreeText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMeetingPrepError(data.error || "보고서 생성에 실패했습니다.");
        return;
      }
      setMeetingPrepReport(data.report || "");
      setMeetingPrepReportAt(new Date());
    } catch (e) {
      setMeetingPrepError("보고서 생성 중 오류가 발생했습니다: " + (e.message || e));
    } finally {
      setMeetingPrepLoading(false);
    }
  }

  useEffect(() => {
    if (!meetingPrepOrg) {
      setMeetingPrepNews([]);
      setMeetingPrepNewsLoading(false);
      return;
    }
    let ignore = false;
    setMeetingPrepNewsLoading(true);
    setMeetingPrepNews([]);
    fetch(`/api/company-news?orgName=${encodeURIComponent(meetingPrepOrg)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) setMeetingPrepNews(data.news || []);
      })
      .catch(() => {
        if (!ignore) setMeetingPrepNews([]);
      })
      .finally(() => {
        if (!ignore) setMeetingPrepNewsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [meetingPrepOrg]);

  const uniqueTargetProducts = useMemo(() => {
    return [...new Set(deals.map((d) => (d.targetProduct || "").replace(/\n/g, " ").trim()).filter(Boolean))].sort();
  }, [deals]);


  const allOrgFlat = useMemo(() => {
    const rows = [];
    groupCards.forEach((g) => {
      g.allOrgs.forEach((o) => rows.push({ ...o, groupName: g.name }));
    });
    return rows;
  }, [groupCards]);

  const searchMatches = useMemo(() => {
    if (!search.trim()) return [];
    return companyRows.filter((o) => matchesSearch(o.name, search)).slice(0, 8);
  }, [search, companyRows]);

  const quickEntries = useMemo(() => {
    return allActivity
      .filter((a) => a.source === "quick-input" && a.id)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 10);
  }, [allActivity]);

  const nlCancelTarget = useMemo(() => {
    if (!nlResult || nlResult.intent !== "cancel" || !nlOverrideDealId) return null;
    const candidates = allActivity.filter((a) => a.dealId === nlOverrideDealId && a.source === "quick-input" && a.id);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return candidates[0];
  }, [nlResult, nlOverrideDealId, allActivity]);

  const myCompanyGroups = useMemo(() => {
    let filtered;
    if (myCompaniesFilter === "favorites") {
      filtered = companyRows.filter((o) => favorites.includes(o.name));
    } else if (myCompaniesFilter === "mine") {
      filtered = companyRows.filter((o) => o.deals.some((d) => d.rm === profile?.name || d.so === profile?.name));
    } else {
      filtered = companyRows;
    }
    const map = {};
    filtered.forEach((o) => {
      if (!map[o.group]) map[o.group] = [];
      map[o.group].push(o);
    });
    return Object.entries(map).sort(([a], [b]) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [companyRows, myCompaniesFilter, profile, favorites]);

  const actionDueDeals = useMemo(() => {
    return activeDeals
      .filter((d) => dealKpiCat[d.id]?.future === "actionDue")
      .sort((a, b) => (dealKpiCat[a.id]?.futureDate || "").localeCompare(dealKpiCat[b.id]?.futureDate || ""));
  }, [activeDeals, dealKpiCat]);

  const todayActionDueDeals = useMemo(() => {
    const todayStr = todayLocalStr();
    return actionDueDeals.filter((d) => dealKpiCat[d.id]?.futureDate === todayStr);
  }, [actionDueDeals, dealKpiCat]);

  // "현재 액션"(activityLog상 가장 최근 항목)이 오늘 날짜인 딜의 안내 문구.
  // "다음 액션"이 오늘 도래해 자동 승격된 경우든, 오늘 직접 활동을 기록한 경우든 상관없이
  // 현재 액션 날짜가 오늘이면 futureReason(nextMeetingDate/nextActionDate/contractRenewalDate) 여부와 무관하게
  // 종모양 알림 "오늘 진행"에 포함시킨다.
  const latestActivityByDeal = useMemo(() => {
    const map = {};
    allActivity.forEach((a) => {
      if (!a.dealId || !a.date) return;
      if (!map[a.dealId] || a.date >= map[a.dealId].date) map[a.dealId] = a;
    });
    return map;
  }, [allActivity]);

  const todayPromotedInfo = useMemo(() => {
    const todayStr = todayLocalStr();
    const map = {};
    Object.values(latestActivityByDeal).forEach((a) => {
      if (a.date === todayStr) map[a.dealId] = a.text || "현재 액션";
    });
    return map;
  }, [latestActivityByDeal]);

  const todayPromotedDeals = useMemo(() => {
    return activeDeals.filter(
      (d) => todayPromotedInfo[d.id] && !todayActionDueDeals.some((x) => x.id === d.id)
    );
  }, [activeDeals, todayPromotedInfo, todayActionDueDeals]);

  const todayBellDeals = useMemo(
    () => [...todayActionDueDeals, ...todayPromotedDeals],
    [todayActionDueDeals, todayPromotedDeals]
  );

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
      .filter((o) => matchesSearch(o.name, search))
      .sort((a, b) => b.expected - a.expected);
  }, [deals, search]);

  async function openDeal(deal, origin) {
    setPanelOrigin(origin || null);
    if (origin) setSelectedOrgName(null);
    setSelected(deal);
    setDetailTab("info");
    setConfirmDropCompany(false);
    setShowMemoHistory(false);
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

  function buildMemoPatch(oldMemo, newMemo, existingHistory) {
    const history = existingHistory || [];
    const updatedHistory = (oldMemo && oldMemo.trim() && oldMemo.trim() !== (newMemo || "").trim())
      ? [...history, { text: oldMemo.trim(), date: todayLocalStr() }]
      : history;
    return { memo: newMemo, memoHistory: updatedHistory };
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

  async function saveActivityText(activityId, date) {
    setSaving(true);
    try {
      const patch = date !== undefined ? { text: editValue, date: date || null } : { text: editValue };
      await updateDoc(doc(db, "activityLog", activityId), patch);
      setActivity((prev) => prev.map((a) => (a.id === activityId ? { ...a, ...patch } : a)));
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
  const [editingFileIdx, setEditingFileIdx] = useState(null);
  const [editFileLabel, setEditFileLabel] = useState("");

  async function handleAddLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
    const updated = [...(selected.relatedFiles || []), { label: newLinkLabel.trim(), url: newLinkUrl.trim() }];
    await saveDealField({ relatedFiles: updated });
    setNewLinkLabel("");
    setNewLinkUrl("");
    setAddingLink(false);
  }

  function startEditFileLabel(idx, currentLabel) {
    setEditingFileIdx(idx);
    setEditFileLabel(currentLabel || "");
  }

  async function handleSaveFileLabel(idx) {
    if (!editFileLabel.trim()) return;
    const files = [...(selected.relatedFiles || [])];
    const f = files[idx];
    const url = typeof f === "string" ? null : f.url;
    files[idx] = url ? { label: editFileLabel.trim(), url } : { label: editFileLabel.trim() };
    await saveDealField({ relatedFiles: files });
    setEditingFileIdx(null);
    setEditFileLabel("");
  }

  async function handleDeleteFile(idx) {
    if (!confirm("이 관련파일을 삭제할까요?")) return;
    const files = (selected.relatedFiles || []).filter((_, i) => i !== idx);
    await saveDealField({ relatedFiles: files });
    if (editingFileIdx === idx) {
      setEditingFileIdx(null);
      setEditFileLabel("");
    }
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
      setNewDealCustomProduct(false);
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

  const nlLastFieldFetchKey = useRef("");
  const [nlFieldLoading, setNlFieldLoading] = useState(false);

  useEffect(() => {
    if (!nlResult || nlResult.intent === "cancel") return;
    if (!nlOverrideDealId || !nlText.trim()) return;
    const key = nlOverrideDealId + "|" + nlText;
    if (nlLastFieldFetchKey.current === key) return;
    nlLastFieldFetchKey.current = key;
    setNlFieldLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/parse-nl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: nlText, dealId: nlOverrideDealId }),
        });
        const data = await res.json();
        if (res.ok) setNlFieldSuggestions(data.fieldSuggestions || []);
      } catch (e) {
      } finally {
        setNlFieldLoading(false);
      }
    })();
  }, [nlOverrideDealId, nlText, nlResult]);

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
      setNlDate(data.date || "");
      setNlActionText(data.actionText || "");
      setNlApplyActivity(true);
      setNlApplyMeeting(!!data.meetingDate);
      setNlMeetingDate(data.meetingDate || "");
      setNlMeetingNote(data.meetingNote || "");
      setNlFieldSuggestions(data.fieldSuggestions || []);
      setNlApplyFields({});
      setNlRelatedFileUrl(data.relatedFileUrl || "");
      setNlRelatedFileLabel(data.relatedFileLabel || "");
      setNlApplyRelatedFile(!!data.relatedFileUrl);

      if (data.orgName) {
        setNlCompanySearch(data.orgName);
        const exists = companyRows.find((o) => o.name === data.orgName);
        if (exists) {
          setNlSelectedOrg(data.orgName);
          // 제품이 특정 안 돼도 일단 첫 제품을 기본 선택 — 그래야 담당자/진행단계 등 라벨 추천이 바로 뜸(사용자가 원하면 드롭다운에서 바꾸면 됨)
          const resolvedDealId = data.dealId || exists.deals[0].id;
          setNlOverrideDealId(resolvedDealId);
          setNlDealAutoGuessed(!data.dealId);
        } else {
          setNlSelectedOrg("");
          setNlOverrideDealId("");
          setNlDealAutoGuessed(false);
        }
      } else {
        setNlCompanySearch("");
        setNlSelectedOrg("");
        setNlOverrideDealId("");
      }
    } catch (e) {
      setNlError(String(e.message || e));
    } finally {
      setNlLoading(false);
    }
  }

  function resetNL() {
    setNlText("");
    setNlResult(null);
    setNlCompanySearch("");
    setNlSelectedOrg("");
    setNlOverrideDealId("");
    setNlDate("");
    setNlActionText("");
    setNlApplyActivity(true);
    setNlApplyMeeting(false);
    setNlMeetingDate("");
    setNlMeetingNote("");
    setNlFieldSuggestions([]);
    setNlApplyFields({});
    setNlRelatedFileUrl("");
    setNlRelatedFileLabel("");
    setNlApplyRelatedFile(false);
    nlLastFieldFetchKey.current = "";
    setNlDealAutoGuessed(false);
  }

  async function handleConfirmNL() {
    if (!nlOverrideDealId) {
      setNlError("타겟제품(딜)을 선택해주세요.");
      return;
    }
    setNlSaving(true);
    try {
      const appliedMeeting = nlApplyMeeting && nlMeetingDate;

      if (nlApplyActivity) {
        const newLogRef = await addDoc(collection(db, "activityLog"), {
          dealId: nlOverrideDealId,
          date: nlDate || null,
          text: nlActionText,
          source: "quick-input",
          appliedMeetingDate: appliedMeeting ? nlMeetingDate : null,
          appliedMeetingNote: appliedMeeting ? (nlMeetingNote || "") : null,
          createdAt: serverTimestamp(),
        });
        setAllActivity((prev) => [...prev, {
          id: newLogRef.id, dealId: nlOverrideDealId, date: nlDate || null, text: nlActionText, source: "quick-input",
          appliedMeetingDate: appliedMeeting ? nlMeetingDate : null, appliedMeetingNote: appliedMeeting ? (nlMeetingNote || "") : null,
        }]);
      }

      if (appliedMeeting) {
        await updateDoc(doc(db, "deals", nlOverrideDealId), {
          nextMeetingDate: nlMeetingDate,
          nextMeetingNote: nlMeetingNote || "",
          updatedAt: serverTimestamp(),
        });
        setDeals((prev) => prev.map((d) => (d.id === nlOverrideDealId ? { ...d, nextMeetingDate: nlMeetingDate, nextMeetingNote: nlMeetingNote || "" } : d)));
      }

      const checkedSuggestions = nlFieldSuggestions.filter((s) => nlApplyFields[s.field]);
      if (checkedSuggestions.length > 0) {
        const patch = {};
        checkedSuggestions.forEach((s) => {
          if (s.field === "expectedPerformanceRaw") {
            patch.expectedPerformanceRaw = s.suggestedValue;
            patch.expectedPerformance = parseAmountKR(s.suggestedValue);
          } else if (s.field === "contractAmount") {
            patch.contractAmount = parseAmountKR(s.suggestedValue);
          } else if (s.field === "memo") {
            const targetDeal = deals.find((d) => d.id === nlOverrideDealId);
            Object.assign(patch, buildMemoPatch(targetDeal?.memo, s.suggestedValue, targetDeal?.memoHistory));
          } else {
            patch[s.field] = s.suggestedValue;
          }
        });
        patch.updatedAt = serverTimestamp();
        await updateDoc(doc(db, "deals", nlOverrideDealId), patch);
        setDeals((prev) => prev.map((d) => (d.id === nlOverrideDealId ? { ...d, ...patch } : d)));
      }

      if (nlApplyRelatedFile && nlRelatedFileUrl) {
        const targetDeal = deals.find((d) => d.id === nlOverrideDealId);
        const updatedFiles = [...(targetDeal?.relatedFiles || []), { label: nlRelatedFileLabel || "첨부자료", url: nlRelatedFileUrl }];
        await updateDoc(doc(db, "deals", nlOverrideDealId), { relatedFiles: updatedFiles });
        setDeals((prev) => prev.map((d) => (d.id === nlOverrideDealId ? { ...d, relatedFiles: updatedFiles } : d)));
      }

      resetNL();
    } catch (e) {
      setNlError("저장 실패: " + (e.message || e));
    } finally {
      setNlSaving(false);
    }
  }

  // 빠른등록 이력 취소 시, 그 등록이 같이 세팅한 "다음 미팅"도 (그 뒤로 더 안 바뀌었다면) 같이 되돌림
  async function revertQuickEntry(entry) {
    await deleteDoc(doc(db, "activityLog", entry.id));
    if (entry.appliedMeetingDate) {
      const dealNow = deals.find((d) => d.id === entry.dealId);
      if (dealNow && dealNow.nextMeetingDate === entry.appliedMeetingDate && (dealNow.nextMeetingNote || "") === (entry.appliedMeetingNote || "")) {
        await updateDoc(doc(db, "deals", entry.dealId), { nextMeetingDate: "", nextMeetingNote: "" });
        setDeals((prev) => prev.map((d) => (d.id === entry.dealId ? { ...d, nextMeetingDate: "", nextMeetingNote: "" } : d)));
      }
    }
    setAllActivity((prev) => prev.filter((a) => a.id !== entry.id));
  }

  async function handleCancelViaNL() {
    setNlSaving(true);
    try {
      await revertQuickEntry(nlCancelTarget);
      resetNL();
    } catch (e) {
      setNlError("취소 실패: " + (e.message || e));
    } finally {
      setNlSaving(false);
    }
  }

  async function deleteQuickEntry(entry) {
    try {
      await revertQuickEntry(entry);
      setNlConfirmDeleteId(null);
    } catch (e) {
      alert("취소 실패: " + (e.message || e));
    }
  }

  async function saveGridField(field) {
    if (field === "expectedPerformanceRaw") {
      await saveDealField({ expectedPerformanceRaw: editValue, expectedPerformance: parseAmountKR(editValue) });
    } else if (field === "contractAmount") {
      const num = editValue.replace(/[^0-9]/g, "");
      await saveDealField({ contractAmount: num ? parseInt(num, 10) : null });
    } else if (field === "contractRenewalDate") {
      await saveDealField({ contractRenewalDate: editValue, contractRenewalInferredByAI: false });
    } else {
      await saveDealField({ [field]: editValue });
    }
  }

  function GridCell({ icon: Icon, label, field, displayValue, type }) {
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
              type={type || "text"}
              className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-2 py-1"
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

  const quickEntryCard = (
          <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-sm font-extrabold text-navy dark:text-gray-100">
                <img src="/tebi-mascot.png" alt="테비" className="w-6 h-6 object-contain -my-1" />
                빠른 등록/취소
              </div>
              <button className="text-[11px] text-navy dark:text-gray-300 underline" onClick={() => setNlHistoryOpen((v) => !v)}>
                최근 이력 {nlHistoryOpen ? "접기" : `보기 (${quickEntries.length})`}
              </button>
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-3 py-2"
                placeholder="예: 9월 20일 신한카드 미팅해서 계약서 전달함 / 신한카드에 입력한거 취소해줘"
                value={nlText}
                onChange={(e) => setNlText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAnalyzeNL(); }}
              />
              <button
                className="text-xs bg-navy text-white px-4 py-2 rounded-lg font-semibold"
                onClick={handleAnalyzeNL}
                disabled={nlLoading}
              >
                {nlLoading ? "분석 중..." : "입력"}
              </button>
            </div>
            {nlError && <p className="text-xs text-red-600 mt-2">{nlError}</p>}

            {nlHistoryOpen && (
              <div className="mt-3 border border-[#E7EAF0] dark:border-gray-700 rounded-xl overflow-hidden">
                {quickEntries.map((a) => {
                  const d = deals.find((dl) => dl.id === a.dealId);
                  return (
                    <div key={a.id} className="px-3 py-2 border-b border-[#F4F6F9] dark:border-gray-800 last:border-b-0 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-navy dark:text-gray-100 flex items-center">
                          {d && <LogoBadge name={d.orgName} />}{d ? d.orgName : "(삭제된 딜)"}
                          <span className="text-gray-400 font-normal ml-1.5">{a.date}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{a.text}</div>
                      </div>
                      {nlConfirmDeleteId === a.id ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-red-500">이전으로 되돌릴까요?</span>
                          <button className="text-[10px] bg-red-600 text-white px-2 py-1 rounded font-semibold" onClick={() => deleteQuickEntry(a)}>확인</button>
                          <button className="text-[10px] text-gray-400" onClick={() => setNlConfirmDeleteId(null)}>아니오</button>
                        </div>
                      ) : (
                        <button
                          className="text-[10px] text-red-400 hover:text-red-600 shrink-0 border border-red-200 dark:border-red-900 rounded px-2 py-1 font-semibold"
                          onClick={() => setNlConfirmDeleteId(a.id)}
                        >
                          취소
                        </button>
                      )}
                    </div>
                  );
                })}
                {quickEntries.length === 0 && (
                  <div className="px-3 py-4 text-center text-[11px] text-gray-300">빠른등록으로 추가한 이력이 없습니다.</div>
                )}
              </div>
            )}

            {nlResult && nlResult.intent === "cancel" ? (
              <div className="mt-3 border border-red-200 dark:border-red-900 rounded-xl p-3 bg-red-50 dark:bg-red-950/30">
                <div className="text-[11px] font-bold text-red-600 mb-2">취소 요청으로 감지했습니다</div>
                {!nlSelectedOrg && (
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <label className="text-[10px] text-gray-400 col-span-2 -mb-1">회사명 검색</label>
                    <input
                      className="text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2 col-span-2"
                      placeholder="회사명 입력"
                      value={nlCompanySearch}
                      onChange={(e) => { setNlCompanySearch(e.target.value); setNlSelectedOrg(""); setNlOverrideDealId(""); }}
                    />
                    {nlCompanySearch && companyRows.filter((o) => matchesSearch(o.name, nlCompanySearch)).slice(0, 6).map((o) => (
                      <button
                        key={o.name}
                        className="text-xs text-left px-2 py-1.5 rounded-lg bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 col-span-2"
                        onClick={() => { setNlSelectedOrg(o.name); setNlOverrideDealId(o.deals.length === 1 ? o.deals[0].id : ""); }}
                      >
                        {o.name}
                      </button>
                    ))}
                  </div>
                )}
                {nlSelectedOrg && (
                  <>
                    <label className="text-[10px] text-gray-400 block mb-0.5">타겟제품 (취소 대상)</label>
                    <select
                      className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2 mb-2"
                      value={nlOverrideDealId}
                      onChange={(e) => setNlOverrideDealId(e.target.value)}
                    >
                      <option value="">-- 타겟제품 선택 --</option>
                      {companyRows.find((o) => o.name === nlSelectedOrg)?.deals.map((d) => (
                        <option key={d.id} value={d.id}>{(d.targetProduct || "").replace(/\n/g, " ")}</option>
                      ))}
                    </select>
                  </>
                )}
                {nlOverrideDealId && (
                  nlCancelTarget ? (
                    <div className="bg-white dark:bg-[#111827] rounded-lg p-2 mb-2">
                      <div className="text-[10px] text-gray-400 mb-0.5">{nlCancelTarget.date}</div>
                      <div className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-200">{nlCancelTarget.text}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 mb-2">이 딜에 빠른등록으로 추가한 최근 이력이 없습니다.</div>
                  )
                )}
                <div className="flex justify-end gap-2">
                  <button className="text-xs text-gray-400" onClick={resetNL}>닫기</button>
                  {nlCancelTarget && (
                    <button className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg" onClick={handleCancelViaNL} disabled={nlSaving}>
                      {nlSaving ? "취소 중..." : "이 내용 취소하기"}
                    </button>
                  )}
                </div>
              </div>
            ) : nlResult && (
              <div className="mt-3 border border-[#E7EAF0] dark:border-gray-700 rounded-xl p-3 bg-[#F8FAFC] dark:bg-[#0B1220]">
                <div className="text-[11px] text-gray-400 mb-2">
                  {nlSelectedOrg ? "AI가 회사를 찾았습니다. 타겟제품을 확인해주세요." : "회사명을 검색해서 선택해주세요."}
                </div>

                <label className="text-[10px] text-gray-400 block mb-0.5">회사명</label>
                <input
                  className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2 mb-1.5"
                  placeholder="회사명 검색"
                  value={nlCompanySearch}
                  onChange={(e) => { setNlCompanySearch(e.target.value); setNlSelectedOrg(""); setNlOverrideDealId(""); }}
                />
                {nlCompanySearch && !nlSelectedOrg && (
                  <div className="space-y-1 mb-2 max-h-28 overflow-y-auto">
                    {companyRows.filter((o) => matchesSearch(o.name, nlCompanySearch)).slice(0, 6).map((o) => (
                      <button
                        key={o.name}
                        className="w-full text-xs text-left px-2 py-1.5 rounded-lg bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700"
                        onClick={() => { setNlSelectedOrg(o.name); setNlOverrideDealId(o.deals.length === 1 ? o.deals[0].id : ""); }}
                      >
                        {o.name}
                      </button>
                    ))}
                    {companyRows.filter((o) => matchesSearch(o.name, nlCompanySearch)).length === 0 && (
                      <div className="text-[11px] text-gray-300 px-2">일치하는 회사가 없습니다.</div>
                    )}
                  </div>
                )}

                {nlSelectedOrg && (
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="col-span-2">
                      <label className="text-[10px] text-gray-400 block mb-0.5">
                        타겟제품
                        {nlDealAutoGuessed && <span className="text-orange-500 font-normal ml-1">(제품이 특정 안 돼서 임의로 골라뒀어요 — 맞는지 확인해주세요)</span>}
                      </label>
                      <select
                        className={"w-full text-xs border rounded-lg px-2 py-2 " + (nlDealAutoGuessed ? "border-orange-300 dark:border-orange-800" : "border-[#E7EAF0] dark:border-gray-700")}
                        value={nlOverrideDealId}
                        onChange={(e) => { setNlOverrideDealId(e.target.value); setNlDealAutoGuessed(false); }}
                      >
                        <option value="">-- 타겟제품 선택 --</option>
                        {companyRows.find((o) => o.name === nlSelectedOrg)?.deals.map((d) => (
                          <option key={d.id} value={d.id}>{(d.targetProduct || "").replace(/\n/g, " ")}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 block mb-0.5">액션 날짜</label>
                      <input
                        type="date"
                        className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2 disabled:opacity-40 disabled:bg-gray-50 dark:disabled:bg-gray-800"
                        value={nlDate}
                        onChange={(e) => setNlDate(e.target.value)}
                        disabled={!nlApplyActivity}
                      />
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-1.5 mb-0.5">
                  <input type="checkbox" checked={nlApplyActivity} onChange={(e) => setNlApplyActivity(e.target.checked)} />
                  <span className="text-[10px] text-gray-400">진행이력 내용 (해제하면 이력에 기록 안 하고 아래 선택한 항목만 반영)</span>
                </label>
                <textarea
                  className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2 mb-2 disabled:opacity-40 disabled:bg-gray-50 dark:disabled:bg-gray-800"
                  rows={2}
                  value={nlActionText}
                  onChange={(e) => setNlActionText(e.target.value)}
                  disabled={!nlApplyActivity}
                />

                {nlMeetingDate && (
                  <div className="text-[11px] text-gray-600 dark:text-gray-300 mb-2 bg-orange-50 dark:bg-orange-950/30 rounded-lg px-2 py-1.5">
                    <label className="flex items-center gap-1.5 mb-1.5">
                      <input type="checkbox" checked={nlApplyMeeting} onChange={(e) => setNlApplyMeeting(e.target.checked)} />
                      <span className="font-semibold">다음 미팅으로 반영</span>
                    </label>
                    <div className="flex gap-2 pl-5">
                      <div>
                        <label className="text-[9px] text-gray-400 block">미팅일자</label>
                        <input
                          type="date"
                          className="text-[11px] border border-[#E7EAF0] dark:border-gray-700 rounded px-1 py-0.5"
                          value={nlMeetingDate}
                          onChange={(e) => setNlMeetingDate(e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[9px] text-gray-400 block">메모</label>
                        <input
                          className="w-full text-[11px] border border-[#E7EAF0] dark:border-gray-700 rounded px-1 py-0.5"
                          value={nlMeetingNote}
                          onChange={(e) => setNlMeetingNote(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {nlFieldLoading && (
                  <div className="mb-2 bg-pink-50 dark:bg-pink-950/30 rounded-lg px-2 py-2 flex items-center gap-1.5 text-[11px] text-pink-600">
                    <Sparkles className="w-3 h-3 animate-pulse" />AI가 라벨 추천 검토 중...
                  </div>
                )}

                {!nlFieldLoading && nlFieldSuggestions.length > 0 && (
                  <div className="mb-2 bg-pink-50 dark:bg-pink-950/30 rounded-lg px-2 py-2 space-y-2">
                    <div className="text-[11px] font-semibold text-pink-600 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />AI가 검토해본 결과, 이런 항목도 같이 바뀌면 어떨까요? <span className="text-gray-400 font-normal">(선택사항)</span>
                    </div>
                    {nlFieldSuggestions.map((s, i) => (
                      <div key={i} className="bg-white dark:bg-[#111827] rounded-lg p-2">
                        <label className="flex items-start gap-1.5">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={!!nlApplyFields[s.field]}
                            onChange={(e) => setNlApplyFields({ ...nlApplyFields, [s.field]: e.target.checked })}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold text-navy dark:text-gray-100">{s.label}</div>
                            <div className="text-[10px] text-gray-400 mb-1">
                              {s.currentValue || "미입력"} <span className="text-pink-500">→</span>{" "}
                              <input
                                type={["nextActionDate", "contractRenewalDate"].includes(s.field) ? "date" : "text"}
                                className="text-[10px] font-semibold text-pink-600 border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] rounded px-1 py-0.5 w-40"
                                value={s.suggestedValue}
                                onChange={(e) => {
                                  const updated = [...nlFieldSuggestions];
                                  updated[i] = { ...updated[i], suggestedValue: e.target.value };
                                  setNlFieldSuggestions(updated);
                                }}
                              />
                            </div>
                            <div className="text-[10px] text-gray-400 italic">{s.reason}</div>
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>
                )}

                {nlRelatedFileLabel && (
                  <div className="mb-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg px-2 py-2">
                    <label className="flex items-start gap-1.5">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={nlApplyRelatedFile}
                        onChange={(e) => setNlApplyRelatedFile(e.target.checked)}
                        disabled={!nlRelatedFileUrl.trim()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-blue-600 flex items-center gap-1 mb-1">
                          <FileText className="w-3 h-3" />
                          {nlRelatedFileUrl ? "관련파일로 추가" : `"${nlRelatedFileLabel}" 언급을 발견했어요 — 링크가 있으면 붙여넣어주세요`}
                          <span className="text-gray-400 font-normal">(선택사항)</span>
                        </div>
                        <input
                          className="text-[11px] border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#111827] dark:text-gray-100 rounded px-1.5 py-1 w-24 mr-1"
                          value={nlRelatedFileLabel}
                          onChange={(e) => setNlRelatedFileLabel(e.target.value)}
                        />
                        <input
                          className="text-[11px] border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#111827] dark:text-gray-100 rounded px-1.5 py-1 w-52 truncate"
                          placeholder="https://..."
                          value={nlRelatedFileUrl}
                          onChange={(e) => { setNlRelatedFileUrl(e.target.value); if (e.target.value.trim()) setNlApplyRelatedFile(true); }}
                        />
                      </div>
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button className="text-xs text-gray-400" onClick={resetNL}>취소</button>
                  <button className="text-xs bg-navy text-white px-3 py-1.5 rounded-lg" onClick={handleConfirmNL} disabled={nlSaving}>
                    {nlSaving ? "저장 중..." : "진행이력에 추가"}
                  </button>
                </div>
              </div>
            )}
          </div>
  );

  return (
    <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#0B1220] flex">
      {mobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setMobileSidebarOpen(false)} />
      )}
      <aside
        className={
          "shrink-0 bg-white dark:bg-[#111827] border-r border-[#ECEEF1] dark:border-gray-700 text-gray-700 dark:text-gray-300 flex flex-col transition-all duration-200 " +
          "fixed inset-y-0 left-0 z-50 md:sticky md:top-0 md:h-screen md:z-auto w-64 " +
          (mobileSidebarOpen ? "translate-x-0" : "-translate-x-full") + " md:translate-x-0 " +
          (sidebarCollapsed ? "md:w-[68px]" : "md:w-60")
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
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.key}
              onClick={() => { setView(item.key); setMobileSidebarOpen(false); }}
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

        <div className={"border-t border-[#ECEEF1] dark:border-gray-700 " + (sidebarCollapsed ? "py-3" : "px-3 py-3")}>
          {!sidebarCollapsed && (
            <div className="text-[10px] font-semibold text-gray-400 px-2 mb-1.5 uppercase tracking-wide">바로가기</div>
          )}
          {SHORTCUT_LINKS.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={sidebarCollapsed ? link.label : undefined}
              className={
                "group mb-0.5 py-2 rounded-lg text-[13px] flex items-center gap-2.5 cursor-pointer text-gray-500 dark:text-gray-400 hover:bg-[#F8F9FB] dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white " +
                (sidebarCollapsed ? "justify-center px-0" : "px-3")
              }
            >
              <link.icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              {!sidebarCollapsed && (
                <>
                  <span className="flex-1 truncate">{link.label}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100" />
                </>
              )}
            </a>
          ))}
        </div>

        {!sidebarCollapsed && (
          <div className="p-4 text-[11px] text-gray-400 border-t border-[#ECEEF1] dark:border-gray-700">
            TechFin Ratings<br />세일즈추진팀
          </div>
        )}
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          className="hidden md:flex absolute -right-3 top-16 w-6 h-6 rounded-full bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 shadow-sm items-center justify-center text-gray-400 hover:text-navy"
        >
          {sidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
        </button>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="bg-white dark:bg-[#111827] border-b border-[#E7EAF0] dark:border-gray-700 px-4 md:px-7 py-3 md:py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden text-gray-500 dark:text-gray-300 p-1.5 -ml-1.5"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base md:text-lg font-extrabold text-navy dark:text-gray-100">
                {view === "dashboard" && "금융기관 세일즈 파이프라인"}
                {view === "pipeline" && "파이프라인 전체 목록"}
                {view === "mycompanies" && "업체현황"}
                {view === "contracts" && "계약·갱신 관리"}
                {view === "quote" && "견적서 작성"}
                {view === "report" && "리포트"}
                {view === "meetingPrep" && "기업상세"}
                {view === "settings" && "설정"}
              </h1>
              <p className="hidden sm:block text-xs text-gray-500 mt-0.5">주요 금융기관과의 협업 현황을 한눈에 확인하세요.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
              <input
                className="text-xs border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#111827] dark:text-gray-100 rounded-lg pl-8 pr-24 py-2 w-32 sm:w-56"
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
              {search && (
                <button
                  onClick={() => { setSearch(""); setSearchOpen(false); }}
                  className="absolute right-[52px] top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 p-0.5 z-10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
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
            <span className="hidden lg:flex text-[11px] bg-green-50 text-green-600 px-2.5 py-1.5 rounded-full font-semibold items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> 실시간 업데이트
            </span>
            <button
              onClick={() => setShowNewDeal(true)}
              className="text-[11px] bg-navy text-white px-2.5 md:px-3 py-2 rounded-lg font-semibold whitespace-nowrap"
            >
              + <span className="hidden sm:inline">상세 </span>등록
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
                {todayBellDeals.length > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {todayBellDeals.length}
                  </span>
                )}
                {(actionDueDeals.length - todayActionDueDeals.length) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {actionDueDeals.length - todayActionDueDeals.length}
                  </span>
                )}
              </button>
              {notifOpen && (() => {
                const todayDeals = todayBellDeals;
                const restDeals = actionDueDeals.filter((d) => !todayActionDueDeals.includes(d));
                const reasonText = (d) => {
                  const reason = dealKpiCat[d.id]?.futureReason;
                  if (reason === "renewal") return `계약갱신 예정 · ${d.contractRenewalDate}`;
                  if (reason === "nextAction") return `${d.nextActionDate} · ${d.nextAction || "다음 액션"}`;
                  if (reason === "meeting") return `${d.nextMeetingDate} ${d.nextMeetingNote || ""}`;
                  if (todayPromotedInfo[d.id]) return `현재 액션 · ${todayPromotedInfo[d.id]}`;
                  return "";
                };
                return (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 top-10 w-72 bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden max-h-96 overflow-y-auto">
                    {todayDeals.length > 0 && (
                      <>
                        <div className="px-4 py-3 border-b border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between bg-green-50/50 dark:bg-green-950/20">
                          <span className="text-xs font-extrabold text-green-600 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />오늘 진행
                          </span>
                          <span className="text-[10px] text-gray-400">{todayDeals.length}건</span>
                        </div>
                        <div>
                          {todayDeals.map((d) => (
                            <div
                              key={d.id}
                              onClick={() => { openDeal(d); setNotifOpen(false); }}
                              className="px-4 py-2.5 border-b border-[#F4F6F9] dark:border-gray-800 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer"
                            >
                              <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1.5 shrink-0" />
                                <LogoBadge name={d.orgName} />{d.orgName}
                              </div>
                              <div className="text-[10px] text-green-600 mt-0.5 ml-[28px]">{reasonText(d)}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="px-4 py-3 border-b border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between">
                      <span className="text-xs font-extrabold text-navy dark:text-gray-100">🟠 액션 도래 (7일 이내)</span>
                      <span className="text-[10px] text-gray-400">{restDeals.length}건</span>
                    </div>
                    <div>
                      {restDeals.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => { openDeal(d); setNotifOpen(false); }}
                          className="px-4 py-2.5 border-b border-[#F4F6F9] dark:border-gray-800 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer"
                        >
                          <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                            <LogoBadge name={d.orgName} />{d.orgName}
                          </div>
                          <div className="text-[10px] text-red-500 mt-0.5 ml-[28px]">{reasonText(d)}</div>
                        </div>
                      ))}
                      {actionDueDeals.length === 0 && (
                        <div className="px-4 py-4 text-center text-[11px] text-gray-300">임박한 액션이 없습니다.</div>
                      )}
                    </div>

                    <div className="px-4 py-3 border-b border-t border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between">
                      <span className="text-xs font-extrabold text-navy dark:text-gray-100 flex items-center gap-1.5">
                        <CalendarClock className="w-3.5 h-3.5 text-purple-500" />계약갱신 (2개월 이내)
                      </span>
                      <span className="text-[10px] text-gray-400">{renewalUpcomingDeals.length}건</span>
                    </div>
                    <div>
                      {renewalUpcomingDeals.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => { openDeal(d); setNotifOpen(false); }}
                          className="px-4 py-2.5 border-b border-[#F4F6F9] dark:border-gray-800 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer"
                        >
                          <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                            <LogoBadge name={d.orgName} />{d.orgName}
                          </div>
                          <div className="text-[10px] text-purple-500 mt-0.5 ml-[28px]">
                            D-{d._daysLeft} · {d.contractRenewalDate} 만기
                          </div>
                        </div>
                      ))}
                      {renewalUpcomingDeals.length === 0 && (
                        <div className="px-4 py-4 text-center text-[11px] text-gray-300">2개월 이내 갱신 예정이 없습니다.</div>
                      )}
                    </div>
                  </div>
                </>
                );
              })()}
            </div>
            <div className="relative">
              <div
                onClick={() => setProfileMenuOpen((v) => !v)}
                className="flex items-center gap-2 pl-3 border-l border-[#E7EAF0] dark:border-gray-700 cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-navy text-white text-xs flex items-center justify-center font-bold">
                  {(profile?.name || "?").slice(0, 1)}
                </div>
                <div className="hidden sm:block text-xs leading-tight">
                  <div className="font-semibold text-navy dark:text-gray-100">{profile?.name || "이름 미설정"}</div>
                  <div className="text-gray-400">{profile?.division || ""}</div>
                </div>
                <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-gray-300" />
              </div>
              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
                  <div className="absolute right-0 top-11 w-56 bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden py-1">
                    <button
                      onClick={() => { setProfileModalKey("favorites"); setProfileMenuOpen(false); }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-[#F8FAFC]"
                    >
                      <span className="flex items-center gap-2"><Star className="w-3.5 h-3.5" />내 관심업체</span>
                      <span className="text-gray-400">{favorites.length}</span>
                    </button>
                    <button
                      onClick={() => { setProfileModalKey("actionNeeded"); setProfileMenuOpen(false); }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-[#F8FAFC]"
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

        <div className="p-4 md:p-7">
          {quickEntryCard}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
            {KPI_DEFS.map((k) => (
              <div
                key={k.key}
                onClick={() => (k.key === "dropped" ? setShowDroppedModal(true) : setKpiModalKey(k.key))}
                className={
                  "bg-white dark:bg-[#111827] border rounded-2xl p-4 cursor-pointer transition " +
                  (activeKpi === k.key ? "border-navy ring-1 " + k.ring : "border-[#E7EAF0] dark:border-gray-700 hover:border-navy/40")
                }
              >
                <div className={"w-9 h-9 rounded-xl flex items-center justify-center mb-2 " + k.bg}>
                  <k.icon className={"w-[18px] h-[18px] " + k.color} strokeWidth={2.2} />
                </div>
                <div className={"text-2xl font-extrabold " + k.color}>
                  {k.key === "dropped"
                    ? droppedCompanyList.length
                    : k.key === "actionDue"
                    ? kpis.actionDue + todayPromotedDeals.length
                    : kpis[k.key]}
                </div>
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
                  <h2 className="text-sm font-extrabold text-navy dark:text-gray-100">
                    산업군별 주요 기관 <span className="text-xs font-normal text-gray-400">(총 {new Set(activeDeals.map((d) => (d.orgName || "").trim())).size}개 업체(드랍 기업 제외))</span>
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">각 카드를 선택하면 해당 그룹 딜만 아래 목록에서 확인할 수 있습니다.</p>
                </div>
                <div className="flex items-center gap-2">
                  {activeGroup !== "전체" && (
                    <button className="text-xs text-navy dark:text-gray-100 underline" onClick={() => setActiveGroup("전체")}>전체 보기</button>
                  )}
                  <div className="flex items-center bg-[#F0F2F5] dark:bg-gray-800 rounded-lg p-1">
                    <button
                      onClick={() => setGroupViewMode("card")}
                      className={"p-1.5 rounded-md " + (groupViewMode === "card" ? "bg-white dark:bg-[#111827] dark:bg-gray-700 text-navy dark:text-gray-100 shadow-sm" : "text-gray-400")}
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setGroupViewMode("list")}
                      className={"p-1.5 rounded-md " + (groupViewMode === "list" ? "bg-white dark:bg-[#111827] dark:bg-gray-700 text-navy dark:text-gray-100 shadow-sm" : "text-gray-400")}
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {groupViewMode === "card" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-7">
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
                    <div className="text-[11px] text-gray-400 mb-3 ml-10">총 {g.orgCount}개 업체</div>
                    <div className="flex items-center gap-1 mb-4 -ml-1">
                      <GroupDonut active7={g.active7} followUp={g.followUp} stale={g.stale} />
                      <div className="flex-1 space-y-2.5 pl-2">
                        <DonutLegendRow color="#16A34A" label="활발 진행 (최근 7일)" value={g.active7} onClick={() => setGroupRecencyModal({ groupName: g.name, recency: "active7" })} />
                        <DonutLegendRow color="#2563EB" label="후속 필요 (8~30일)" value={g.followUp} onClick={() => setGroupRecencyModal({ groupName: g.name, recency: "followUp" })} />
                        <DonutLegendRow color="#DC2626" label="장기 정체 (30일 초과)" value={g.stale} onClick={() => setGroupRecencyModal({ groupName: g.name, recency: "stale" })} />
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
                      <option value="completed">계약 완료</option>
                      <option value="dropped">드랍</option>
                    </select>
                  </div>
                  <div className="overflow-x-auto">
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
                        .filter((o) => matchesSearch(o.name, search))
                        .map((o) => {
                          const cat = dealKpiCat[o.deal.id]?.recency;
                          const info = cat ? RECENCY_LABEL[cat] : null;
                          return (
                            <tr key={o.groupName + o.name} onClick={() => openDeal(o.deal)}>
                              <td>{o.groupName}</td>
                              <td style={{ fontWeight: 700 }}><LogoBadge name={o.name} />{o.name}</td>
                              <td>{(o.deal.targetProduct || "").replace(/\n/g, " ")}</td>
                              <td>{info && <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-semibold " + info[1]}>{info[0]}</span>}</td>
                              <td><span className={probPillClass(o.deal.probability)}>{o.deal.probability || "미상"}</span></td>
                              <td>{[o.deal.rm, o.deal.so].filter(Boolean).join(" / ")}</td>
                              <td>{formatWon(o.deal.expectedPerformance)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}
            </>
          )}

          {view === "dashboard" && (
            <div className="overflow-x-auto">
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
                    <td><span className={probPillClass(d.probability)}>{d.probability || "미상"}</span></td>
                    <td>{d.stage || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {view === "mycompanies" && (
            <div>
              <div className="flex items-center gap-2 mb-5 flex-wrap">
                {[
                  { key: "all", label: "전체 업체" },
                  { key: "mine", label: "담당 업체" },
                  { key: "favorites", label: "관심 업체" },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setMyCompaniesFilter(t.key)}
                    className={"text-xs px-3 py-1.5 rounded-lg font-semibold border flex items-center gap-1 " + (myCompaniesFilter === t.key ? "bg-navy text-white border-navy" : "bg-white dark:bg-[#111827] text-gray-500 border-[#E7EAF0] dark:border-gray-700")}
                  >
                    {t.key === "favorites" && <Star className="w-3 h-3" />}
                    {t.label}
                  </button>
                ))}
                {!profile?.name && myCompaniesFilter === "mine" && (
                  <span className="text-[11px] text-gray-400">본인 이름이 설정되어 있어야 매칭됩니다.</span>
                )}
              </div>

              {myCompanyGroups.map(([groupName, orgs]) => (
                <div key={groupName} className="mb-7">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center">
                      <GroupIcon name={groupName} className="w-3.5 h-3.5 text-navy dark:text-gray-100" />
                    </div>
                    <div className="text-sm font-extrabold text-navy dark:text-gray-100">{groupName}</div>
                    <div className="text-[11px] text-gray-400">{orgs.length}개 기업</div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {orgs.map((o) => {
                      const rmSoSet = [...new Set(o.deals.flatMap((d) => [d.rm, d.so]).filter(Boolean))];
                      return (
                        <div
                          key={o.name}
                          onClick={() => openDeal(o.deals[0])}
                          className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-xl p-3 cursor-pointer hover:border-navy/40"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center text-sm font-bold text-navy dark:text-gray-100 min-w-0">
                              <LogoBadge name={o.name} /><span className="truncate">{o.name}</span>
                            </div>
                            <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-semibold shrink-0 ml-1 " + RECENCY_LABEL[o.dominant][1]}>
                              {RECENCY_LABEL[o.dominant][0]}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400 mb-2 ml-[28px] truncate">{rmSoSet.join(" / ") || "담당자 미상"}</div>
                          <div className="flex items-center gap-1 flex-wrap ml-[28px]">
                            {Object.entries(o.counts).filter(([, v]) => v > 0).map(([cat, v]) => (
                              <span key={cat} className="text-[9px] bg-[#F0F2F5] dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-md font-semibold">
                                {cat} {v}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {myCompanyGroups.length === 0 && (
                <div className="text-center text-xs text-gray-300 py-16">
                  {myCompaniesFilter === "mine" && "담당 중인 업체가 없습니다."}
                  {myCompaniesFilter === "favorites" && "별표로 등록한 관심업체가 없습니다."}
                  {myCompaniesFilter === "all" && "표시할 업체가 없습니다."}
                </div>
              )}
            </div>
          )}

          {view === "contracts" && (() => {
            const filteredList =
              contractTab === "pending" ? contractRenewalList.filter((d) => d._daysLeft !== null && d._daysLeft >= 0 && d._daysLeft <= 60)
              : contractTab === "done" ? []
              : contractRenewalList;
            const upcoming = contractRenewalList.filter((d) => d._daysLeft !== null && d._daysLeft >= 0).slice(0, 4);
            const thisMonth = todayLocalStr().slice(0, 7);
            const calendarItems = contractRenewalList
              .filter((d) => (d.contractRenewalDate || "").slice(0, 7) === thisMonth)
              .sort((a, b) => (a.contractRenewalDate || "").localeCompare(b.contractRenewalDate || ""));

            return (
              <div>
                <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4 mb-5">
                  <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">이번 달 갱신 캘린더</div>
                  {calendarItems.length > 0 ? (
                    <div className="flex items-center gap-3 overflow-x-auto pb-1">
                      {calendarItems.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => openDeal(d)}
                          className="shrink-0 border border-[#E7EAF0] dark:border-gray-700 rounded-xl px-3 py-2 cursor-pointer hover:border-navy/40 min-w-[140px]"
                        >
                          <div className="text-[10px] text-gray-400 mb-1">{d.contractRenewalDate}</div>
                          <div className="text-xs font-bold text-navy dark:text-gray-100 truncate">{d.orgName}</div>
                          <div className="text-[10px] text-gray-400">계약 만기</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-300 text-center py-6">이번 달 갱신 예정 건이 없습니다.</div>
                  )}
                </div>

                <div className="text-sm text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300 rounded-xl px-4 py-3 mb-5 flex items-start gap-2">
                  <span className="font-bold shrink-0">운영 안내</span>
                  <span className="text-blue-300">|</span>
                  <span>별도 입력이 없을 경우 기본 계약기간은 1년이며, 만기 60일 전에 갱신 확인이 필요합니다.</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  {[
                    { key: "total", icon: FileText, color: "text-blue-600 bg-blue-50", label: "전체 계약", value: `${contractKpis.total}건` },
                    { key: "within60", icon: Clock3, color: "text-amber-600 bg-amber-50", label: "60일 이내 갱신 예정", value: `${contractKpis.within60}건` },
                    { key: "within30", icon: AlertTriangle, color: "text-red-600 bg-red-50", label: "30일 이내 우선 확인", value: `${contractKpis.within30}건` },
                    { key: "thisMonth", icon: Wallet, color: "text-green-600 bg-green-50", label: "이번 달 예상 갱신금액", value: formatEok(contractKpis.thisMonthAmount) },
                  ].map((k) => (
                    <div
                      key={k.label}
                      onClick={() => setContractKpiModal(k.key)}
                      className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4 cursor-pointer hover:border-navy/40"
                    >
                      <div className={"w-9 h-9 rounded-lg flex items-center justify-center mb-2 " + k.color}>
                        <k.icon className="w-4.5 h-4.5" />
                      </div>
                      <div className="text-2xl font-extrabold text-navy dark:text-gray-100">{k.value}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{k.label}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-base font-extrabold text-navy dark:text-gray-100">계약 완료 업체 현황</div>
                      <button onClick={() => setShowNewDeal(true)} className="text-xs bg-navy text-white px-3 py-2 rounded-lg font-semibold">+ 계약 등록</button>
                    </div>
                    <div className="flex items-center gap-1 mb-3 border-b border-[#E7EAF0] dark:border-gray-700">
                      {[
                        { key: "all", label: `전체 (${contractRenewalList.length})` },
                        { key: "pending", label: `갱신 예정 (${contractKpis.within30 + contractKpis.within60})` },
                        { key: "done", label: "갱신 완료 (0)" },
                      ].map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setContractTab(t.key)}
                          className={"text-sm px-3 py-2 border-b-2 -mb-px font-semibold " + (contractTab === t.key ? "border-navy text-navy dark:text-gray-100" : "border-transparent text-gray-400")}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="deals" style={{ whiteSpace: "nowrap" }}>
                        <thead>
                          <tr>
                            <th>업체명</th><th>상품/서비스</th><th>계약시작일</th><th>계약만기일</th>
                            <th>남은기간</th><th>계약금액</th><th>담당자</th><th>상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredList.map((d) => (
                            <tr key={d.id} onClick={() => openDeal(d)}>
                              <td style={{ fontWeight: 700 }}><LogoBadge name={d.orgName} />{d.orgName}</td>
                              <td>{(d.targetProduct || "").replace(/\n/g, " ")}</td>
                              <td>{d.contractStartDate || "-"}</td>
                              <td>{d.contractRenewalDate || "-"}</td>
                              <td>
                                {d._daysLeft === null ? (
                                  <span className="text-gray-300">-</span>
                                ) : (
                                  <span className={"font-bold " + (d._daysLeft <= 14 ? "text-red-600" : d._daysLeft <= 30 ? "text-orange-500" : "text-gray-500")}>
                                    D{d._daysLeft < 0 ? "+" + Math.abs(d._daysLeft) : "-" + d._daysLeft}
                                  </span>
                                )}
                              </td>
                              <td>{formatWon(d.contractAmount)}</td>
                              <td>{[d.rm, d.so].filter(Boolean).join(" / ")}</td>
                              <td><span className={"text-[10px] px-2 py-1 rounded-md font-semibold " + d._status.cls}>{d._status.label}</span></td>
                            </tr>
                          ))}
                          {filteredList.length === 0 && (
                            <tr><td colSpan={8} style={{ textAlign: "center", color: "#9CA3AF" }}>해당하는 계약이 없습니다.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">다가오는 갱신</div>
                      <div className="space-y-2.5">
                        {upcoming.map((d, i) => (
                          <div key={d.id} onClick={() => openDeal(d)} className="flex items-center gap-2.5 cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-gray-800 rounded-lg p-1.5 -m-1.5">
                            <div className="w-5 h-5 rounded-full bg-[#F0F2F5] dark:bg-gray-700 text-[10px] font-bold text-gray-500 flex items-center justify-center shrink-0">{i + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-navy dark:text-gray-100 truncate">{d.orgName}</div>
                            </div>
                            <span className={"text-[10px] px-1.5 py-0.5 rounded-md font-bold shrink-0 " + d._status.cls}>D-{d._daysLeft}</span>
                          </div>
                        ))}
                        {upcoming.length === 0 && <div className="text-xs text-gray-300 text-center py-4">예정된 갱신이 없습니다.</div>}
                      </div>
                    </div>

                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">갱신 메모</div>
                      <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
                        <div className="flex items-start gap-1.5"><span className="text-green-500 shrink-0">✓</span>만기 60일 전부터 갱신 검토 시작</div>
                        <div className="flex items-start gap-1.5"><span className="text-green-500 shrink-0">✓</span>조건 변경 시 내부 승인 후 고객 협의</div>
                        <div className="flex items-start gap-1.5"><span className="text-green-500 shrink-0">✓</span>갱신 완료 시 계약갱신일을 새 만기일로 업데이트</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {view === "quote" && (() => {
            const updateProduct = (key, patch) => {
              setQuote((q) => ({ ...q, products: q.products.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
            };
            const updatePolicy = (idx, checked) => {
              setQuote((q) => ({ ...q, policies: q.policies.map((p, i) => (i === idx ? { ...p, checked } : p)) }));
            };
            const resetQuote = () => {
              setQuote((q) => ({ ...q, customerName: "", contactName: "", email: "", memo: "" }));
            };
            const handlePrint = () => window.print();

            return (
              <div>
                <div className="text-sm text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300 rounded-xl px-4 py-3 mb-5 flex items-center justify-between gap-2 no-print">
                  <span className="flex items-center gap-2">
                    <span className="font-bold shrink-0">ℹ️</span>
                    자동 견적 생성 + 상세 편집 기능으로 견적서 작성 시간을 줄여보세요.
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={resetQuote} className="text-xs border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#111827] text-navy dark:text-gray-100 px-3 py-2 rounded-lg font-semibold">초기화</button>
                    <button onClick={handlePrint} className="text-xs border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#111827] text-navy dark:text-gray-100 px-3 py-2 rounded-lg font-semibold">PDF 미리보기</button>
                    <button onClick={handlePrint} className="text-xs bg-navy text-white px-3 py-2 rounded-lg font-semibold">견적서 생성</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 no-print-container">
                  {/* 왼쪽: 입력 폼 */}
                  <div className="space-y-4 no-print">
                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">① 고객 정보</div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">고객사명 *</label>
                          <input className="w-full text-sm border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-3 py-2" value={quote.customerName} onChange={(e) => setQuote({ ...quote, customerName: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">담당자명 *</label>
                          <input className="w-full text-sm border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-3 py-2" value={quote.contactName} onChange={(e) => setQuote({ ...quote, contactName: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">이메일</label>
                          <input className="w-full text-sm border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-3 py-2" value={quote.email} onChange={(e) => setQuote({ ...quote, email: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">견적일 *</label>
                          <input type="date" className="w-full text-sm border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-3 py-2" value={quote.quoteDate} onChange={(e) => setQuote({ ...quote, quoteDate: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">유효기간 *</label>
                          <input type="date" className="w-full text-sm border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-3 py-2" value={quote.validUntil} onChange={(e) => setQuote({ ...quote, validUntil: e.target.value })} />
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">② 상품 구성</div>
                      <div className="grid grid-cols-2 gap-3">
                        {quote.products.map((p) => (
                          <div
                            key={p.key}
                            className={"border rounded-xl p-3 cursor-pointer " + (p.selected ? "border-navy" : "border-[#E7EAF0] dark:border-gray-700 opacity-50")}
                            onClick={() => updateProduct(p.key, { selected: !p.selected })}
                          >
                            <div className="text-xs font-bold text-navy dark:text-gray-100">{p.name}</div>
                            <div className="text-[10px] text-gray-400 mb-2">{p.desc}</div>
                            {["standard", "pro"].map((plan) => (
                              <label key={plan} onClick={(e) => e.stopPropagation()} className="flex items-center justify-between py-1 cursor-pointer">
                                <span className="flex items-center gap-1.5 text-xs">
                                  <input type="radio" checked={p.plan === plan} onChange={() => updateProduct(p.key, { plan, selected: true })} />
                                  <span className="font-semibold capitalize">{plan === "pro" ? "Pro" : "Standard"}</span>
                                </span>
                                <span className="text-xs font-bold text-navy dark:text-gray-100">{formatWon(plan === "pro" ? p.proPrice : p.standardPrice)}/월</span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">③ 가격 설정</div>
                      <div className="grid grid-cols-4 gap-3 mb-3">
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">정가(월)</label>
                          <div className="text-sm font-bold text-navy dark:text-gray-100 border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-3 py-2 bg-[#F8FAFC] dark:bg-[#0B1220]">{quoteCalc.listTotal.toLocaleString()}원</div>
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">할인율</label>
                          <div className="flex items-center border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2">
                            <input type="number" className="w-full text-sm py-2 outline-none dark:bg-[#111827] dark:text-gray-100" value={quote.discountRate} onChange={(e) => setQuote({ ...quote, discountRate: Number(e.target.value) })} />
                            <span className="text-xs text-gray-400">%</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">최종 월 금액</label>
                          <div className="text-sm font-bold text-blue-600 border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-3 py-2 bg-[#F8FAFC] dark:bg-[#0B1220]">{quoteCalc.finalMonthly.toLocaleString()}원</div>
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">계약기간</label>
                          <select className="w-full text-sm border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-3 py-2" value={quote.contractMonths} onChange={(e) => setQuote({ ...quote, contractMonths: Number(e.target.value) })}>
                            {[6, 12, 24, 36].map((m) => <option key={m} value={m}>{m}개월</option>)}
                          </select>
                        </div>
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
                        <input type="checkbox" checked={quote.vatIncluded} onChange={(e) => setQuote({ ...quote, vatIncluded: e.target.checked })} /> VAT 포함
                      </label>
                      <div className="bg-[#F8FAFC] dark:bg-[#0B1220] rounded-xl p-3 flex items-center gap-6">
                        <div className="text-[11px] text-gray-400 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" />자동 계산 결과</div>
                        <div className="text-xs"><span className="text-gray-400">월 이용료(VAT{quote.vatIncluded ? "포함" : "별도"}) </span><span className="font-bold text-navy dark:text-gray-100">{quoteCalc.finalMonthly.toLocaleString()}원</span></div>
                        <div className="text-xs"><span className="text-gray-400">연간금액 </span><span className="font-bold text-navy dark:text-gray-100">{quoteCalc.annual.toLocaleString()}원</span></div>
                        <div className="text-xs"><span className="text-gray-400">할인금액(연간) </span><span className="font-bold text-green-600">{quoteCalc.discountAnnual.toLocaleString()}원</span></div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">④ 이용정책 / 메모</div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1.5">이용정책</label>
                          <div className="space-y-1.5">
                            {quote.policies.map((p, i) => (
                              <label key={i} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                                <input type="checkbox" checked={p.checked} onChange={(e) => updatePolicy(i, e.target.checked)} /> {p.label}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1.5">특이사항</label>
                          <textarea maxLength={500} rows={4} className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-2 py-1.5" value={quote.memo} onChange={(e) => setQuote({ ...quote, memo: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 오른쪽: 실시간 미리보기 */}
                  <div>
                    <div className="flex items-center justify-between mb-2 no-print">
                      <div className="text-xs text-gray-400">{quoteEditMode ? "요소를 클릭해서 직접 수정하세요." : "자동 생성된 견적서입니다."}</div>
                      <div className="flex gap-2">
                        {editedQuoteHtml !== null && (
                          <button onClick={resetQuoteToAuto} className="text-[11px] text-gray-400 underline">자동생성으로 되돌리기</button>
                        )}
                        {quoteEditMode ? (
                          <button onClick={exitQuoteEditMode} className="text-[11px] bg-navy text-white px-3 py-1.5 rounded-lg font-semibold">편집 완료</button>
                        ) : (
                          <button onClick={enterQuoteEditMode} className="text-[11px] border border-navy text-navy dark:text-gray-100 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />상세 편집
                          </button>
                        )}
                      </div>
                    </div>

                    {quoteEditMode && (
                      <div className="flex flex-wrap items-center gap-1 mb-2 p-2 bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-xl no-print">
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteExec("undo")} className="p-1.5 rounded hover:bg-[#F0F2F5]" title="실행취소"><span className="text-sm">↶</span></button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteExec("redo")} className="p-1.5 rounded hover:bg-[#F0F2F5]" title="다시실행"><span className="text-sm">↷</span></button>
                        <span className="w-px h-4 bg-[#E7EAF0] mx-1" />
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteExec("bold")} className="px-2 py-1 rounded hover:bg-[#F0F2F5] font-bold text-xs">B</button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteExec("italic")} className="px-2 py-1 rounded hover:bg-[#F0F2F5] italic text-xs">I</button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteExec("underline")} className="px-2 py-1 rounded hover:bg-[#F0F2F5] underline text-xs">U</button>
                        <span className="w-px h-4 bg-[#E7EAF0] mx-1" />
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteExec("justifyLeft")} className="p-1.5 rounded hover:bg-[#F0F2F5] text-xs">왼쪽</button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteExec("justifyCenter")} className="p-1.5 rounded hover:bg-[#F0F2F5] text-xs">가운데</button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteExec("justifyRight")} className="p-1.5 rounded hover:bg-[#F0F2F5] text-xs">오른쪽</button>
                        <span className="w-px h-4 bg-[#E7EAF0] mx-1" />
                        <select onMouseDown={(e) => e.preventDefault()} onChange={(e) => quoteExec("fontSize", e.target.value)} className="text-xs border border-[#E7EAF0] rounded px-1 py-1" defaultValue="">
                          <option value="" disabled>글자크기</option>
                          <option value="2">작게</option>
                          <option value="3">보통</option>
                          <option value="5">크게</option>
                          <option value="7">아주크게</option>
                        </select>
                        <input onMouseDown={(e) => e.preventDefault()} type="color" onChange={(e) => quoteExec("foreColor", e.target.value)} className="w-7 h-7 border border-[#E7EAF0] rounded cursor-pointer" title="글자색" />
                        <span className="w-px h-4 bg-[#E7EAF0] mx-1" />
                        <button onMouseDown={(e) => e.preventDefault()} onClick={quoteInsertText} className="px-2 py-1 rounded hover:bg-[#F0F2F5] text-xs">+텍스트</button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={quoteInsertTable} className="px-2 py-1 rounded hover:bg-[#F0F2F5] text-xs">+표</button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteInsertShape("rect")} className="px-2 py-1 rounded hover:bg-[#F0F2F5] text-xs">+사각형</button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => quoteInsertShape("circle")} className="px-2 py-1 rounded hover:bg-[#F0F2F5] text-xs">+원</button>
                        <button onMouseDown={(e) => e.preventDefault()} onClick={quoteInsertLine} className="px-2 py-1 rounded hover:bg-[#F0F2F5] text-xs">+선</button>
                        <label onMouseDown={(e) => e.preventDefault()} className="px-2 py-1 rounded hover:bg-[#F0F2F5] text-xs cursor-pointer">
                          +이미지
                          <input type="file" accept="image/*" className="hidden" onChange={quoteInsertImage} />
                        </label>
                      </div>
                    )}

                    {editedQuoteHtml !== null ? (
                      <div
                        id="quote-print-area"
                        ref={quotePrintRef}
                        contentEditable={quoteEditMode}
                        suppressContentEditableWarning
                        onBlur={() => { if (quotePrintRef.current) setEditedQuoteHtml(quotePrintRef.current.innerHTML); }}
                        className={"bg-white text-[#1E293B] rounded-2xl shadow-lg overflow-hidden " + (quoteEditMode ? "ring-2 ring-navy" : "")}
                        style={{ width: "100%", maxWidth: "700px", margin: "0 auto", outline: "none" }}
                        dangerouslySetInnerHTML={{ __html: editedQuoteHtml }}
                      />
                    ) : (
                    <div id="quote-print-area" ref={quotePrintRef} className="bg-white text-[#1E293B] rounded-2xl shadow-lg overflow-hidden" style={{ width: "100%", maxWidth: "700px", margin: "0 auto" }}>
                      <div className="px-8 py-7" style={{ background: "linear-gradient(135deg, #0D1F4E, #16306E)" }}>
                        <div className="flex items-center justify-between">
                          <div className="text-white text-2xl font-extrabold italic">crediview</div>
                          <div className="text-right">
                            <div className="text-white/60 text-[10px] tracking-widest">QUOTATION</div>
                            <div className="text-white text-lg font-extrabold">견적서</div>
                          </div>
                        </div>
                        <div className="text-white/70 text-[11px] mt-1">by ㈜테크핀레이팅스 | Corporate Monitoring & Data Service</div>
                      </div>

                      <div className="px-8 py-6">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <div className="text-lg font-extrabold">{quote.customerName || "고객사명"} 귀중</div>
                            <div className="text-xs text-gray-500 mt-1">귀사의 무궁한 발전을 기원합니다.<br />아래와 같이 크레디뷰 서비스에 대한 견적서를 제출합니다.</div>
                          </div>
                          <div className="text-right text-[11px] text-gray-500 shrink-0 ml-4">
                            <div>견적번호 <b className="text-navy">{quoteNumber}</b></div>
                            <div>견적일 <b>{(quote.quoteDate || "").replace(/-/g, "년 ").replace(/(\d+)$/, "$1일").replace("년 ", "년 ").replace(/^(\d+)년/, "$1년") }</b></div>
                            <div>유효기간 <b>{quote.validUntil}</b></div>
                          </div>
                        </div>

                        <div className="bg-[#F4F6F9] rounded-xl p-3 mb-4">
                          <div className="text-xs font-bold text-navy mb-1 flex items-center gap-1"><span className="w-1.5 h-3.5 bg-navy inline-block rounded-sm" />서비스 개요</div>
                          <div className="text-[11px] text-gray-600 leading-relaxed">crediview는 국내 최대 기업 데이터와 정교한 분석 기술을 바탕으로, 기업의 리스크를 사전에 파악하고 비즈니스 기회를 확장할 수 있는 인사이트를 제공합니다.</div>
                        </div>

                        <div className="text-xs font-bold text-navy mb-2 flex items-center gap-1"><span className="w-1.5 h-3.5 bg-navy inline-block rounded-sm" />제공 서비스 및 가격</div>
                        <table className="w-full text-[11px] mb-3" style={{ borderCollapse: "collapse" }}>
                          <thead>
                            <tr className="bg-[#F4F6F9] text-gray-500">
                              <th className="text-left font-semibold py-2 px-2">서비스명</th>
                              <th className="text-center font-semibold py-2 px-2">선택 상품</th>
                              <th className="text-left font-semibold py-2 px-2">주요 제공 내용</th>
                              <th className="text-right font-semibold py-2 px-2">월 이용료(VAT{quote.vatIncluded ? "포함" : "별도"})</th>
                            </tr>
                          </thead>
                          <tbody>
                            {quoteCalc.selected.map((p) => (
                              <tr key={p.key} className="border-b border-[#F0F2F5]">
                                <td className="py-2 px-2 font-semibold">{p.name}</td>
                                <td className="py-2 px-2 text-center">
                                  <span className="bg-navy text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">{p.plan === "pro" ? "Pro" : "Standard"}</span>
                                </td>
                                <td className="py-2 px-2 text-gray-500">
                                  {p.features.map((f, i) => <div key={i}>· {f}</div>)}
                                </td>
                                <td className="py-2 px-2 text-right font-bold">{(p.plan === "pro" ? p.proPrice : p.standardPrice).toLocaleString()}원</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <div className="bg-[#EAF1FF] rounded-xl px-4 py-3 flex items-center justify-between mb-4">
                          <span className="text-xs font-extrabold text-navy">최종 견적금액 (VAT{quote.vatIncluded ? "포함" : "별도"})</span>
                          <span className="text-xs text-gray-600">월 이용료 <b className="text-blue-600 text-sm">{quoteCalc.finalMonthly.toLocaleString()}원</b>{"  "}연간금액({quote.contractMonths}개월) <b className="text-blue-600 text-sm">{quoteCalc.annual.toLocaleString()}원</b></span>
                        </div>

                        <div className="text-xs font-bold text-navy mb-2 flex items-center gap-1"><span className="w-1.5 h-3.5 bg-navy inline-block rounded-sm" />이용 정책</div>
                        <ol className="text-[11px] text-gray-600 space-y-1 mb-4 list-decimal list-inside">
                          <li>본 견적서는 발행일로부터 {Math.round((new Date(quote.validUntil) - new Date(quote.quoteDate)) / 86400000) || 30}일간 유효합니다.</li>
                          <li>서비스 이용은 ㈜테크핀레이팅스의 이용약관에 따릅니다.</li>
                          <li>계약 체결 후 서비스 개시까지 영업일 기준 최대 5일이 소요될 수 있습니다.</li>
                          {quote.memo && <li>{quote.memo}</li>}
                        </ol>

                        <div className="text-right text-navy italic font-extrabold text-lg mt-6">crediview</div>
                        <div className="text-right text-[10px] text-gray-400">by ㈜테크핀레이팅스</div>
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {view === "report" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* 견적 (왼쪽, 크게, 도넛 포함) */}
                <div className="md:row-span-2 bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-1.5">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-blue-600 bg-blue-50">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="text-xl font-extrabold text-navy dark:text-gray-100">견적</div>
                    <div className="ml-auto text-sm text-gray-400 text-right">
                      총 {probSummary.quote.totalCount}건 <span className="text-gray-300">|</span> {formatEok(probSummary.quote.totalAmount)}
                    </div>
                  </div>
                  <div className="text-sm text-gray-400 mb-4">고객사에 제안한 견적 건을 기준으로 집계한 현황입니다.</div>

                  <div className="flex items-center justify-center gap-8 mb-5">
                    <div className="relative w-[180px] h-[180px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={probSummary.quote.rows.filter((r) => r.count > 0).length > 0
                              ? probSummary.quote.rows.filter((r) => r.count > 0).map((r) => ({ name: r.label, value: r.count }))
                              : [{ name: "없음", value: 1 }]}
                            dataKey="value"
                            innerRadius="68%"
                            outerRadius="100%"
                            startAngle={90}
                            endAngle={-270}
                            stroke="none"
                            paddingAngle={3}
                            cornerRadius={8}
                            isAnimationActive={false}
                          >
                            {(probSummary.quote.rows.filter((r) => r.count > 0).length > 0
                              ? probSummary.quote.rows.filter((r) => r.count > 0)
                              : [{ key: "없음" }]
                            ).map((r, i) => (
                              <Cell key={i} fill={{ 상: "#16A34A", 중: "#D97706", 하: "#DC2626" }[r.key] || "#E5E7EB"} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none translate-x-[3px]">
                        <span className="text-3xl font-extrabold text-navy dark:text-gray-100 leading-none">{probSummary.quote.totalCount}</span>
                        <span className="text-xs text-gray-400 mt-1">총 견적건</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {[
                        { key: "상", color: "#16A34A" },
                        { key: "중", color: "#D97706" },
                        { key: "하", color: "#DC2626" },
                      ].map(({ key, color }) => {
                        const r = probSummary.quote.rows.find((x) => x.key === key);
                        return (
                          <div key={key} className="flex items-center gap-2 text-sm">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                            <span className="font-semibold text-gray-500">{key}</span>
                            <span className="font-extrabold text-navy dark:text-gray-100">{r ? r.count : 0}건</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-xs">
                        <th className="text-left font-normal pb-2">구분</th>
                        <th className="text-right font-normal pb-2">건수</th>
                        <th className="text-right font-normal pb-2">업체수</th>
                        <th className="text-right font-normal pb-2">금액</th>
                        <th className="w-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {probSummary.quote.rows.map((r) => (
                        <tr
                          key={r.key}
                          onClick={() => setReportModal({ type: "probBucket", key: `quote:${r.key}` })}
                          className="border-t border-[#F4F6F9] dark:border-gray-800 cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-gray-800"
                        >
                          <td className="py-2.5 font-semibold text-navy dark:text-gray-100">{r.label}</td>
                          <td className="py-2.5 text-right">{r.count}</td>
                          <td className="py-2.5 text-right text-gray-500">{r.orgCount}개사</td>
                          <td className="py-2.5 text-right font-semibold text-blue-600">{formatEok(r.amount)}</td>
                          <td className="py-2.5 text-right text-gray-300">›</td>
                        </tr>
                      ))}
                      <tr
                        onClick={() => setReportModal({ type: "probBucket", key: "quote:total" })}
                        className="border-t border-[#E7EAF0] dark:border-gray-700 font-extrabold cursor-pointer bg-blue-50/60 dark:bg-blue-950/30"
                      >
                        <td className="py-2.5 text-navy dark:text-gray-100">총합</td>
                        <td className="py-2.5 text-right text-navy dark:text-gray-100">{probSummary.quote.totalCount}</td>
                        <td className="py-2.5 text-right text-navy dark:text-gray-100">{probSummary.quote.totalOrgCount}개사</td>
                        <td className="py-2.5 text-right text-blue-600">{formatEok(probSummary.quote.totalAmount)}</td>
                        <td className="py-2.5 text-right text-gray-300">›</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 계약 (오른쪽 위) */}
                <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-1.5">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-green-600 bg-green-50">
                      <UserCheck className="w-5 h-5" />
                    </div>
                    <div className="text-xl font-extrabold text-navy dark:text-gray-100">계약</div>
                    <div className="ml-auto text-sm text-gray-400 text-right">
                      총 {probSummary.contract.totalCount}건 <span className="text-gray-300">|</span> {formatEok(probSummary.contract.totalAmount)}
                    </div>
                  </div>
                  <div className="text-sm text-gray-400 mb-3">협의가 완료되어 실제 계약으로 확정된 건의 현황입니다.</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-xs">
                        <th className="text-left font-normal pb-2">구분</th>
                        <th className="text-right font-normal pb-2">건수</th>
                        <th className="text-right font-normal pb-2">업체수</th>
                        <th className="text-right font-normal pb-2">금액</th>
                        <th className="w-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        onClick={() => setReportModal({ type: "probBucket", key: "contract:total" })}
                        className="border-t border-[#F4F6F9] dark:border-gray-800 cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-gray-800"
                      >
                        <td className="py-2.5 font-semibold text-navy dark:text-gray-100">계약</td>
                        <td className="py-2.5 text-right">{probSummary.contract.totalCount}</td>
                        <td className="py-2.5 text-right text-gray-500">{probSummary.contract.totalOrgCount}개사</td>
                        <td className="py-2.5 text-right font-semibold text-green-600">{formatEok(probSummary.contract.totalAmount)}</td>
                        <td className="py-2.5 text-right text-gray-300">›</td>
                      </tr>
                      <tr
                        onClick={() => setReportModal({ type: "probBucket", key: "contract:total" })}
                        className="border-t border-[#E7EAF0] dark:border-gray-700 font-extrabold cursor-pointer bg-green-50/60 dark:bg-green-950/30"
                      >
                        <td className="py-2.5 text-navy dark:text-gray-100">총합</td>
                        <td className="py-2.5 text-right text-navy dark:text-gray-100">{probSummary.contract.totalCount}</td>
                        <td className="py-2.5 text-right text-navy dark:text-gray-100">{probSummary.contract.totalOrgCount}개사</td>
                        <td className="py-2.5 text-right text-green-600">{formatEok(probSummary.contract.totalAmount)}</td>
                        <td className="py-2.5 text-right text-gray-300 w-4">›</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 드랍 (오른쪽 아래) */}
                <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-1.5">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-red-600 bg-red-50">
                      <X className="w-5 h-5" />
                    </div>
                    <div className="text-xl font-extrabold text-navy dark:text-gray-100">드랍</div>
                    <div className="ml-auto text-sm text-gray-400 text-right">
                      총 {probSummary.drop.totalCount}건 <span className="text-gray-300">|</span> {formatEok(probSummary.drop.totalAmount)}
                    </div>
                  </div>
                  <div className="text-sm text-gray-400 mb-3">검토 후 진행이 중단되었거나 계약으로 이어지지 않은 건의 현황입니다.</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-xs">
                        <th className="text-left font-normal pb-2">구분</th>
                        <th className="text-right font-normal pb-2">건수</th>
                        <th className="text-right font-normal pb-2">업체수</th>
                        <th className="text-right font-normal pb-2">금액</th>
                        <th className="w-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        onClick={() => setReportModal({ type: "probBucket", key: "drop:total" })}
                        className="border-t border-[#F4F6F9] dark:border-gray-800 cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-gray-800"
                      >
                        <td className="py-2.5 font-semibold text-navy dark:text-gray-100">드랍</td>
                        <td className="py-2.5 text-right">{probSummary.drop.totalCount}</td>
                        <td className="py-2.5 text-right text-gray-500">{probSummary.drop.totalOrgCount}개사</td>
                        <td className="py-2.5 text-right font-semibold text-red-600">{formatEok(probSummary.drop.totalAmount)}</td>
                        <td className="py-2.5 text-right text-gray-300">›</td>
                      </tr>
                      <tr
                        onClick={() => setReportModal({ type: "probBucket", key: "drop:total" })}
                        className="border-t border-[#E7EAF0] dark:border-gray-700 font-extrabold cursor-pointer bg-red-50/60 dark:bg-red-950/30"
                      >
                        <td className="py-2.5 text-navy dark:text-gray-100">총합</td>
                        <td className="py-2.5 text-right text-navy dark:text-gray-100">{probSummary.drop.totalCount}</td>
                        <td className="py-2.5 text-right text-navy dark:text-gray-100">{probSummary.drop.totalOrgCount}개사</td>
                        <td className="py-2.5 text-right text-red-600">{formatEok(probSummary.drop.totalAmount)}</td>
                        <td className="py-2.5 text-right text-gray-300 w-4">›</td>
                      </tr>
                    </tbody>
                  </table>
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

          {view === "meetingPrep" && (
            <div>
              <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-4 mb-4">
                <label className="text-xs font-semibold text-gray-500 block mb-1.5">기업 선택</label>
                <div className="relative max-w-md">
                  <Search className="w-4 h-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className="w-full text-sm border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg pl-9 pr-24 py-2.5"
                    placeholder="기업명 검색"
                    value={meetingPrepOrg || meetingPrepSearch}
                    onChange={(e) => {
                      setMeetingPrepSearch(e.target.value);
                      setMeetingPrepOrg("");
                      setMeetingPrepReport(""); setMeetingPrepReportAt(null);
                      setMeetingPrepError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && meetingPrepMatches[0]) {
                        setMeetingPrepOrg(meetingPrepMatches[0].name);
                        setMeetingPrepSearch("");
                        setMeetingPrepReport(""); setMeetingPrepReportAt(null);
                        setMeetingPrepError("");
                      }
                    }}
                  />
                  {(meetingPrepOrg || meetingPrepSearch) && (
                    <button
                      onClick={() => {
                        setMeetingPrepSearch("");
                        setMeetingPrepOrg("");
                        setMeetingPrepReport(""); setMeetingPrepReportAt(null);
                        setMeetingPrepError("");
                      }}
                      className="absolute right-[52px] top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (meetingPrepMatches[0]) {
                        setMeetingPrepOrg(meetingPrepMatches[0].name);
                        setMeetingPrepSearch("");
                        setMeetingPrepReport(""); setMeetingPrepReportAt(null);
                        setMeetingPrepError("");
                      }
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-navy text-white text-[10px] px-2 py-1.5 rounded-md"
                  >
                    검색
                  </button>
                  {meetingPrepSearch && !meetingPrepOrg && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                      {meetingPrepMatches.map((o) => (
                        <button
                          key={o.name}
                          className="w-full text-left text-xs px-3 py-2 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 flex items-center gap-2"
                          onClick={() => {
                            setMeetingPrepOrg(o.name);
                            setMeetingPrepSearch("");
                            setMeetingPrepReport(""); setMeetingPrepReportAt(null);
                            setMeetingPrepError("");
                          }}
                        >
                          <LogoBadge name={o.name} />
                          <span className="font-semibold">{o.name}</span>
                          <span className="text-gray-300">· {o.deals.length}건</span>
                        </button>
                      ))}
                      {meetingPrepMatches.length === 0 && (
                        <div className="text-xs text-gray-300 px-3 py-2">일치하는 기업이 없습니다.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {!meetingPrepOrg ? (
                <div className="text-center text-sm text-gray-300 py-20">기업을 검색해서 선택하면 기업상세 정보를 확인할 수 있습니다.</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* 왼쪽: 기업정보 / 제품현황 / 히스토리 */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-extrabold text-navy dark:text-gray-100">선택한 기업 정보</div>
                        <button
                          onClick={() => { setMeetingPrepOrg(""); setMeetingPrepReport(""); setMeetingPrepReportAt(null); setMeetingPrepError(""); }}
                          className="text-[11px] text-navy dark:text-gray-100 border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2.5 py-1 font-semibold"
                        >
                          기업 변경
                        </button>
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <LogoBadge name={meetingPrepOrg} />
                        <div>
                          <div className="text-base font-extrabold text-navy dark:text-gray-100">{meetingPrepOrg}</div>
                          <div className="text-[11px] text-gray-400">{mapGroupName(meetingPrepDeals[0]?.orgGroup)}</div>
                        </div>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex gap-2">
                          <span className="w-20 text-gray-400 shrink-0">담당자</span>
                          <span className="text-gray-700 dark:text-gray-300">{[...new Set(meetingPrepDeals.map((d) => d.contactPerson).filter(Boolean))].join(", ") || "-"}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="w-20 text-gray-400 shrink-0">최근 접촉일</span>
                          <span className="text-gray-700 dark:text-gray-300">{meetingPrepLastContact || "-"}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="w-20 text-gray-400 shrink-0">다음 미팅일</span>
                          <span className="text-gray-700 dark:text-gray-300">
                            {meetingPrepNextMeeting ? `${meetingPrepNextMeeting.nextMeetingDate} (${meetingPrepNextMeeting.targetProduct || ""})` : "예정된 미팅 없음"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <span className="w-20 text-gray-400 shrink-0">관심 제품</span>
                          <span className="text-gray-700 dark:text-gray-300">{meetingPrepDeals.map((d) => d.targetProduct).filter(Boolean).join(", ") || "-"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">타겟 제품별 현황 ({meetingPrepDeals.length})</div>
                      <div className="space-y-2">
                        {meetingPrepDeals.map((d) => (
                          <div key={d.id} className="border border-[#E7EAF0] dark:border-gray-700 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-navy dark:text-gray-100">{(d.targetProduct || "제품 미상").replace(/\n/g, " ")}</span>
                              <span className={probPillClass(d.probability)}>{d.probability || "-"}</span>
                            </div>
                            <div className="text-[11px] text-gray-400">{d.stage || "단계 미상"} · 최근 액션 {lastActionByDeal[d.id] || "-"}</div>
                          </div>
                        ))}
                        {meetingPrepDeals.length === 0 && <div className="text-xs text-gray-300">등록된 딜이 없습니다.</div>}
                      </div>
                    </div>

                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">과거 히스토리 / 액션 ({meetingPrepActivity.length})</div>
                      <div className="relative pl-4 space-y-3 border-l-2 border-[#E7EAF0] dark:border-gray-700 max-h-[380px] overflow-y-auto">
                        {meetingPrepActivity.slice(0, 20).map((a, i) => (
                          <div key={a.id || i} className="relative">
                            <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-navy border-2 border-white ring-1 ring-[#E7EAF0]" />
                            <div className="text-[10px] text-gray-400 mb-0.5">
                              {a.date || "날짜 미상"} · {(meetingPrepDealById[a.dealId]?.targetProduct || "").replace(/\n/g, " ")}
                            </div>
                            <div className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{a.text}</div>
                          </div>
                        ))}
                        {meetingPrepActivity.length === 0 && <div className="text-xs text-gray-300">등록된 이력이 없습니다.</div>}
                      </div>
                    </div>
                  </div>

                  {/* 오른쪽: 보고서 생성 / 미리보기 */}
                  <div className="lg:col-span-5 space-y-4">
                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="flex items-center gap-1.5 mb-3">
                        <Newspaper className="w-3.5 h-3.5 text-navy dark:text-gray-100" />
                        <div className="text-sm font-extrabold text-navy dark:text-gray-100">최근 뉴스 ({meetingPrepNews.length})</div>
                      </div>
                      {meetingPrepNewsLoading && (
                        <div className="text-xs text-gray-300 py-4 text-center">뉴스를 불러오는 중...</div>
                      )}
                      {!meetingPrepNewsLoading && meetingPrepNews.length === 0 && (
                        <div className="text-xs text-gray-300 py-4 text-center">최근 30일 이내 검색된 뉴스가 없습니다.</div>
                      )}
                      {!meetingPrepNewsLoading && meetingPrepNews.length > 0 && (
                        <div className="space-y-2 max-h-[280px] overflow-y-auto">
                          {meetingPrepNews.map((n, i) => (
                            <a
                              key={i}
                              href={n.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group block border border-[#E7EAF0] dark:border-gray-700 rounded-xl p-2.5 hover:border-navy/40 hover:bg-[#F8FAFC] dark:hover:bg-gray-800"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 leading-snug group-hover:text-navy dark:group-hover:text-white">
                                  {n.title}
                                </div>
                                <ExternalLink className="w-3 h-3 text-gray-300 shrink-0 mt-0.5 group-hover:text-navy" />
                              </div>
                              <div className="text-[10px] text-gray-400 mt-1">
                                {n.source || "출처 미상"}{n.date ? ` · ${n.date.slice(0, 10)}` : ""}
                              </div>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                      <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-3">미팅 사전 보고서 생성</div>
                      <div className="text-[11px] text-gray-400 mb-2">이번 미팅 목적을 선택하세요.</div>
                      <div className="grid grid-cols-2 gap-1.5 mb-3">
                        {MEETING_PURPOSE_OPTIONS.map((opt) => (
                          <button
                            key={opt.key}
                            onClick={() => setMeetingPrepPurpose(opt.key)}
                            className={
                              "text-[11px] px-2.5 py-2 rounded-lg border text-left font-semibold " +
                              (meetingPrepPurpose === opt.key
                                ? "border-navy bg-blue-50 dark:bg-blue-950/30 text-navy dark:text-gray-100"
                                : "border-[#E7EAF0] dark:border-gray-700 text-gray-500 dark:text-gray-400")
                            }
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <label className="text-[11px] text-gray-400 block mb-1">이번 미팅 목적 또는 알고 싶은 내용 (선택)</label>
                      <textarea
                        rows={3}
                        className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-2.5 py-2 mb-3"
                        placeholder="예: 지난 미팅에서 조합원사 데이터 커버리지를 궁금해했음. 이번에는 기업DB조회와 기업모니터링 도입 가능성을 중심으로 미팅 준비"
                        value={meetingPrepFreeText}
                        onChange={(e) => setMeetingPrepFreeText(e.target.value)}
                      />
                      <button
                        onClick={handleGenerateMeetingBrief}
                        disabled={meetingPrepLoading}
                        className="w-full bg-navy text-white text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        {meetingPrepLoading ? "생성 중..." : (<><Sparkles className="w-3.5 h-3.5" />미팅 사전 보고서 생성</>)}
                      </button>
                      {meetingPrepError && <div className="text-[11px] text-red-500 mt-2">{meetingPrepError}</div>}
                    </div>

                    {(meetingPrepReport || meetingPrepLoading) && (
                      <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-5 pt-4 pb-3 no-print">
                          <div className="text-sm font-extrabold text-navy dark:text-gray-100">미팅 사전 보고서</div>
                          {meetingPrepReport && (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => navigator.clipboard?.writeText(meetingPrepReport)}
                                className="text-[11px] border border-[#E7EAF0] dark:border-gray-700 px-2 py-1 rounded-lg flex items-center gap-1 text-navy dark:text-gray-100"
                              >
                                <Copy className="w-3 h-3" />복사
                              </button>
                              <button
                                onClick={() => window.print()}
                                className="text-[11px] border border-navy bg-navy text-white px-2.5 py-1 rounded-lg flex items-center gap-1 font-semibold"
                              >
                                <Printer className="w-3 h-3" />PDF 출력
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="px-5 pb-5">
                          <div className="max-h-[640px] overflow-y-auto print:max-h-none print:overflow-visible rounded-xl border border-[#E7EAF0] dark:border-gray-700 print:border-0 print:rounded-none">
                            <div id="brief-print-area" className="bg-white text-[#1E293B]">
                              {meetingPrepLoading ? (
                                <div className="text-xs text-gray-400 py-16 text-center">AI가 미팅 사전 보고서를 작성하고 있습니다...</div>
                              ) : (
                                <>
                                  {/* 레터헤드 헤더 */}
                                  <div className="px-8 py-7" style={{ background: "linear-gradient(135deg, #0D1F4E, #16306E)" }}>
                                    <div className="flex items-center justify-between">
                                      <div className="text-white text-2xl font-extrabold italic">crediview</div>
                                      <div className="text-right">
                                        <div className="text-white/60 text-[10px] tracking-widest">MEETING BRIEF</div>
                                        <div className="text-white text-lg font-extrabold">미팅 사전 보고서</div>
                                      </div>
                                    </div>
                                    <div className="text-white/70 text-[11px] mt-1">by ㈜테크핀레이팅스 | Corporate Sales Intelligence</div>
                                  </div>

                                  {/* 기업 · 미팅 메타 정보 */}
                                  <div className="px-8 py-5 border-b border-[#E7EAF0]">
                                    <div className="flex items-start justify-between gap-4 flex-wrap">
                                      <div className="flex items-center gap-2.5">
                                        <span className="inline-flex w-9 h-9 rounded-lg border border-[#E7EAF0] items-center justify-center overflow-hidden bg-white shrink-0">
                                          <LogoBadge name={meetingPrepOrg} />
                                        </span>
                                        <div>
                                          <div className="text-base font-extrabold text-navy leading-tight">{meetingPrepOrg}</div>
                                          <div className="text-[10.5px] text-gray-400">{mapGroupName(meetingPrepDeals[0]?.orgGroup)}</div>
                                        </div>
                                      </div>
                                      <div className="text-right text-[10.5px] text-gray-500 space-y-0.5 shrink-0">
                                        <div>보고서 생성일 <b className="text-navy">{formatReportDate(meetingPrepReportAt)}</b></div>
                                        <div>미팅 목적 <b className="text-navy">{MEETING_PURPOSE_OPTIONS.find((o) => o.key === meetingPrepPurpose)?.label || "-"}</b></div>
                                        <div>작성자 <b className="text-navy">{profile?.name || "-"}{profile?.division ? ` · ${profile.division}` : ""}</b></div>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2.5 mt-4" style={{ breakInside: "avoid" }}>
                                      <div className="bg-[#F4F6F9] rounded-lg px-3 py-2">
                                        <div className="text-[9.5px] text-gray-400">담당자</div>
                                        <div className="text-[11px] font-bold text-navy mt-0.5 truncate">
                                          {[...new Set(meetingPrepDeals.map((d) => d.contactPerson).filter(Boolean))].join(", ") || "-"}
                                        </div>
                                      </div>
                                      <div className="bg-[#F4F6F9] rounded-lg px-3 py-2">
                                        <div className="text-[9.5px] text-gray-400">최근 접촉일</div>
                                        <div className="text-[11px] font-bold text-navy mt-0.5">{meetingPrepLastContact || "-"}</div>
                                      </div>
                                      <div className="bg-[#F4F6F9] rounded-lg px-3 py-2">
                                        <div className="text-[9.5px] text-gray-400">다음 미팅일</div>
                                        <div className="text-[11px] font-bold text-navy mt-0.5">{meetingPrepNextMeeting?.nextMeetingDate || "미정"}</div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* AI 생성 본문 */}
                                  <div className="px-8 py-6">
                                    {renderBriefMarkdown(meetingPrepReport)}
                                  </div>

                                  {/* 푸터 */}
                                  <div className="px-8 pb-7 pt-4 flex items-end justify-between border-t border-[#E7EAF0] mt-2" style={{ breakInside: "avoid" }}>
                                    <div className="text-[9px] text-gray-400 leading-relaxed max-w-[68%]">
                                      본 보고서는 사내 세일즈 파이프라인 데이터와 AI 분석을 기반으로 자동 생성되었으며, 실제 미팅 준비를 위한 참고 자료입니다.
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className="text-navy italic font-extrabold text-base leading-none">crediview</div>
                                      <div className="text-[9px] text-gray-400 mt-0.5">by ㈜테크핀레이팅스</div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {view === "settings" && (
            <div className="max-w-md space-y-4">
              <div className="bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-700 rounded-2xl p-5">
                <div className="text-sm font-extrabold text-navy dark:text-gray-100 mb-1">카카오워크 알림</div>
                <p className="text-xs text-gray-400 mb-3">카카오워크 이메일을 등록하면 매일 아침 액션도래·AI추천 항목을 봇이 DM으로 요약해드립니다.</p>
                <label className="text-[11px] text-gray-400 block mb-1">카카오워크 이메일</label>
                <input
                  className="w-full text-sm border border-[#E7EAF0] dark:border-gray-700 dark:bg-[#0B1220] dark:text-gray-100 rounded-lg px-3 py-2 mb-2"
                  placeholder="you@techfinratings.com"
                  value={kakaoworkEmailInput}
                  onChange={(e) => setKakaoworkEmailInput(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs bg-navy text-white px-3 py-2 rounded-lg font-semibold"
                    onClick={handleSaveKakaoworkEmail}
                    disabled={savingKakaoworkEmail}
                  >
                    {savingKakaoworkEmail ? "저장 중..." : "저장"}
                  </button>
                  {profile?.kakaoworkEmail && (
                    <span className="text-[11px] text-green-600">✓ {profile.kakaoworkEmail} 등록됨</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-navy-deep/30 z-30" onClick={() => setSelected(null)} />
          <div className="fixed top-0 right-0 w-[440px] max-w-full h-screen bg-white dark:bg-[#111827] z-40 overflow-y-auto shadow-2xl">
            <div className="px-6 py-5 border-b border-[#E7EAF0] dark:border-gray-700 relative bg-gradient-to-br from-white to-[#F4F6F9] dark:from-[#111827] dark:to-[#0B1220] shrink-0">
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
                    {droppedOrgNames.has((selected.orgName || "").trim()) && (
                      <span className="text-[10px] bg-gray-800 text-white px-2 py-1 rounded-md font-semibold">드랍</span>
                    )}
                    {(() => {
                      const cat = dealKpiCat[selected.id];
                      const labelMap = { active7: ["활발 진행", "text-green-600 bg-green-50"], followUp: ["후속 필요", "text-blue-600 bg-blue-50"], stale: ["장기 정체", "text-red-600 bg-red-50"], completed: ["계약 완료", "text-navy bg-blue-100"], dropped: ["드랍", "text-gray-500 bg-gray-100"] };
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
                <div className="px-6 py-4 border-b border-[#E7EAF0] dark:border-gray-700 shrink-0">
                  <div className="text-xs font-extrabold text-navy dark:text-gray-100 mb-2">타겟제품 ({companyDeals.length})</div>
                  <div className="flex gap-2 mb-2">
                    {catList.map(([cat, v]) => (
                      <button
                        key={cat}
                        onClick={() => setActiveProductCat(cat)}
                        className={
                          "text-xs px-3 py-1.5 rounded-lg font-semibold border " +
                          (activeProductCat === cat ? "bg-navy text-white border-navy" : "bg-white dark:bg-[#111827] text-gray-500 border-[#E7EAF0] dark:border-gray-700")
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
                                {d.dataChannel && (
                                  <span className="ml-1.5 text-[9px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-md font-semibold align-middle">
                                    {d.dataChannel}
                                  </span>
                                )}
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
            <div className="px-6 py-4 border-b border-[#E7EAF0] dark:border-gray-700 space-y-2 shrink-0">
              {[
                { icon: ClipboardList, color: "bg-blue-50 text-blue-600", label: "지난번 액션", date: activity[1]?.date, text: activity[1]?.text, field: "prevAction", editable: !!activity[1] },
                { icon: PlayCircle, color: "bg-navy/10 text-navy dark:text-gray-100", label: "현재 액션", date: activity[0]?.date, text: activity[0]?.text, field: "currentAction", editable: !!activity[0] },
                { icon: Flag, color: "bg-orange-100 text-orange-600", label: "다음 액션", date: selected.nextActionDate || (selected.nextAction ? "예정" : null), text: selected.nextAction, field: "nextAction", editable: true, highlight: true },
              ].map((row) => (
                <div key={row.field} className={"rounded-xl border p-3 " + (row.highlight ? "border-orange-200 bg-orange-50" : "border-[#E7EAF0] dark:border-gray-700")}>
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
                            <button
                              className="text-[10px] text-navy dark:text-gray-100 underline"
                              onClick={() => {
                                startEdit(row.field, row.text);
                                setEditNextActionDate(selected.nextActionDate || todayLocalStr());
                                setEditActivityDate(row.date || todayLocalStr());
                              }}
                            >
                              수정
                            </button>
                          )}
                        </div>
                      </div>
                      {editingField !== row.field ? (
                        <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{row.text || "미입력"}</div>
                      ) : (
                        <div className="mt-1.5 space-y-1.5">
                          <input
                            className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                          />
                          {row.field === "nextAction" && (
                            <div>
                              <label className="text-[9px] text-gray-400 block mb-0.5">실행 예정일 (지나면 알림에 표시)</label>
                              <input
                                type="date"
                                className="text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5"
                                value={editNextActionDate}
                                onChange={(e) => setEditNextActionDate(e.target.value)}
                              />
                            </div>
                          )}
                          {row.field === "currentAction" && (
                            <div>
                              <label className="text-[9px] text-gray-400 block mb-0.5">액션 날짜</label>
                              <input
                                type="date"
                                className="text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5"
                                value={editActivityDate}
                                onChange={(e) => setEditActivityDate(e.target.value)}
                              />
                            </div>
                          )}
                          <div className="flex gap-2 justify-end">
                            <button className="text-[10px] text-gray-400" onClick={cancelEdit}>취소</button>
                            <button
                              className="text-[10px] bg-navy text-white px-2 py-1 rounded-lg"
                              disabled={saving}
                              onClick={() =>
                                row.field === "nextAction"
                                  ? saveDealField({ nextAction: editValue, nextActionDate: editNextActionDate || null })
                                  : row.field === "currentAction"
                                  ? saveActivityText(activity[0].id, editActivityDate)
                                  : saveActivityText(activity[1].id)
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
                { key: "related", label: "연관기업" },
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
                    <GridCell
                      icon={Layers}
                      label="타겟제품"
                      field="targetProduct"
                      displayValue={
                        <>
                          {(selected.targetProduct || "").replace(/\n/g, " ") || "-"}
                          {selected.dataChannel && (
                            <span className="ml-1.5 text-[9px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-md font-semibold align-middle">
                              {selected.dataChannel}
                            </span>
                          )}
                        </>
                      }
                    />
                    <GridCell icon={User} label="담당자" field="contactPerson" displayValue={selected.contactPerson || "-"} />
                    <GridCell icon={Users} label="RM" field="rm" displayValue={selected.rm || "-"} />
                    <GridCell icon={Users} label="SO" field="so" displayValue={selected.so || "-"} />
                    <GridCell icon={TrendingUp} label="기대실적" field="expectedPerformanceRaw" displayValue={formatWon(selected.expectedPerformance)} />
                    <GridCell icon={Wallet} label="계약금액" field="contractAmount" displayValue={formatWon(selected.contractAmount)} />
                    <GridCell icon={CalendarClock} label="계약목표" field="contractGoal" displayValue={selected.contractGoal || "-"} />
                    <GridCell icon={CalendarClock} label="계약시작일" field="contractStartDate" type="date" displayValue={selected.contractStartDate || "-"} />
                    <GridCell
                      icon={CalendarClock}
                      label={"계약갱신일" + (selected.contractRenewalInferredByAI ? " (AI 추정)" : "")}
                      field="contractRenewalDate"
                      type="date"
                      displayValue={selected.contractRenewalDate || "-"}
                    />

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

                  <div className="px-6 py-3 border-b border-[#E7EAF0] dark:border-gray-700">
                    <div className="text-[10px] text-gray-400 mb-1 flex items-center gap-1"><Percent className="w-3 h-3" />계약가능성</div>
                    <select
                      className="text-xs font-semibold border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1"
                      value={selected.probability || ""}
                      onChange={(e) => saveDealField({ probability: e.target.value })}
                    >
                      {["상", "중", "하", "완료", "드랍"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  <div className="px-6 py-3 border-b border-[#E7EAF0] dark:border-gray-700">
                    <div className="text-[10px] text-gray-400 mb-1">방문미팅</div>
                    <div className="text-xs text-gray-700 dark:text-gray-300">{selected.visitMeetingRaw || "-"}</div>
                  </div>

                  <div className="px-6 py-4 border-b border-[#E7EAF0] dark:border-gray-700">
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
                      onSave={() => saveDealField(buildMemoPatch(selected.memo, editValue, selected.memoHistory))}
                      saving={saving}
                    />
                    {(selected.memoHistory || []).length > 0 && (
                      <div className="mt-2">
                        <button
                          className="text-[10px] text-navy dark:text-gray-100 underline"
                          onClick={() => setShowMemoHistory((v) => !v)}
                        >
                          이전 메모 이력 {showMemoHistory ? "접기" : `보기 (${selected.memoHistory.length})`}
                        </button>
                        {showMemoHistory && (
                          <div className="mt-2 relative pl-4 space-y-3 border-l-2 border-[#E7EAF0] dark:border-gray-700">
                            {[...selected.memoHistory].reverse().map((h, i) => (
                              <div key={i} className="relative">
                                <span className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-gray-300 border-2 border-white dark:border-[#111827]" />
                                <div className="text-[10px] text-gray-400 mb-0.5">{h.date}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">{h.text}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="px-6 py-4 border-b border-[#E7EAF0] dark:border-gray-700">
                    <div className="text-[10px] text-gray-400 mb-1">다음 미팅</div>
                    {editingField !== "meeting" ? (
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-700 dark:text-gray-300">
                          {selected.nextMeetingDate ? `${selected.nextMeetingDate} ${selected.nextMeetingNote || ""}` : "미입력"}
                        </div>
                        <button className="text-[10px] text-navy dark:text-gray-100 underline" onClick={() => setEditingField("meeting")}>수정</button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex gap-1.5">
                          <input type="date" className="border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5 w-1/2 text-xs" value={editMeetingDate} onChange={(e) => setEditMeetingDate(e.target.value)} />
                          <input className="border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5 w-1/2 text-xs" placeholder="메모" value={editMeetingNote} onChange={(e) => setEditMeetingNote(e.target.value)} />
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
                    <div className="relative pl-4 space-y-4 border-l-2 border-[#E7EAF0] dark:border-gray-700">
                      {activity.slice(0, 3).map((a, i) => (
                        <div key={i} className="relative">
                          <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-navy border-2 border-white ring-1 ring-[#E7EAF0]" />
                          <div className="text-[11px] text-gray-400 mb-0.5">{a.date || "날짜 미상"}</div>
                          <div className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{a.text}</div>
                        </div>
                      ))}
                      {activity.length === 0 && <div className="text-xs text-gray-300">이력이 없습니다.</div>}
                    </div>
                  </div>

                  <div className="px-6 py-4 border-t border-[#E7EAF0] dark:border-gray-700">
                    <div className="text-[10px] font-bold text-red-500 mb-2">위험 영역</div>
                    {confirmDropCompany ? (
                      <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
                        <div className="text-xs text-red-600 mb-2">
                          "{selected.orgName}"을(를) 삭제하면 산업군·업체현황 등 모든 화면에서 제외됩니다. (드랍기업 목록에서 언제든 복구 가능)
                        </div>
                        <div className="flex justify-end gap-2">
                          <button className="text-[11px] text-gray-400" onClick={() => setConfirmDropCompany(false)}>취소</button>
                          <button
                            className="text-[11px] bg-red-600 text-white px-2.5 py-1.5 rounded-lg font-semibold"
                            onClick={() => { dropCompany(selected.orgName); setConfirmDropCompany(false); setSelected(null); }}
                          >
                            삭제(드랍)
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="text-[11px] text-red-500 border border-red-200 dark:border-red-900 rounded-lg px-2.5 py-1.5"
                        onClick={() => setConfirmDropCompany(true)}
                      >
                        이 기업 삭제(드랍)
                      </button>
                    )}
                  </div>
                </>
              )}

              {detailTab === "history" && (
                <div className="px-6 py-4">
                  <div className="text-xs font-extrabold text-navy dark:text-gray-100 mb-3">액션 히스토리 ({activity.length})</div>
                  <div className="relative pl-4 space-y-4 border-l-2 border-[#E7EAF0] dark:border-gray-700">
                    {activity.map((a, i) => (
                      <div key={i} className="relative">
                        <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-navy border-2 border-white ring-1 ring-[#E7EAF0]" />
                        <div className="text-[11px] text-gray-400 mb-0.5">{a.date || "날짜 미상"}</div>
                        <div className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{a.text}</div>
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

                      if (editingFileIdx === i) {
                        return (
                          <div key={i} className="flex items-center gap-1.5 bg-[#F8FAFC] dark:bg-gray-800 rounded-lg px-3 py-2">
                            <FileText className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                            <input
                              autoFocus
                              className="flex-1 text-xs bg-white dark:bg-gray-700 border border-[#E7EAF0] dark:border-gray-600 rounded px-2 py-1"
                              value={editFileLabel}
                              onChange={(e) => setEditFileLabel(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleSaveFileLabel(i); if (e.key === "Escape") setEditingFileIdx(null); }}
                            />
                            <button
                              onClick={() => handleSaveFileLabel(i)}
                              className="shrink-0 text-navy dark:text-gray-100 hover:opacity-70"
                              title="저장"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingFileIdx(null)}
                              className="shrink-0 text-gray-400 hover:text-gray-600"
                              title="취소"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={i}
                          className="group text-xs text-gray-700 dark:text-gray-300 bg-[#F8FAFC] dark:bg-gray-800 hover:bg-[#EEF2F7] dark:hover:bg-gray-700 rounded-lg px-3 py-2 flex items-center gap-2"
                        >
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 flex-1 min-w-0 break-words">
                              <FileText className="w-3.5 h-3.5 text-gray-300 shrink-0" />{label}
                            </a>
                          ) : (
                            <div className="flex items-center gap-2 flex-1 min-w-0 break-words">
                              <FileText className="w-3.5 h-3.5 text-gray-300 shrink-0" />{label}
                            </div>
                          )}
                          <button
                            onClick={() => startEditFileLabel(i, label)}
                            className="shrink-0 text-gray-300 hover:text-navy dark:hover:text-gray-100 opacity-0 group-hover:opacity-100"
                            title="파일명 수정"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteFile(i)}
                            className="shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    {(!selected.relatedFiles || selected.relatedFiles.length === 0) && (
                      <div className="text-xs text-gray-300">관련파일이 없습니다.</div>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-300 mb-3">※ 더존 사내 그룹웨어 링크는 로그인된 상태에서만 열립니다.</div>

                  <div className="border-t border-[#E7EAF0] dark:border-gray-700 pt-3 space-y-2">
                    {!addingLink ? (
                      <button className="text-[11px] text-navy dark:text-gray-100 underline" onClick={() => setAddingLink(true)}>+ 링크 추가</button>
                    ) : (
                      <div className="space-y-1.5">
                        <input
                          className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5"
                          placeholder="파일/문서 이름"
                          value={newLinkLabel}
                          onChange={(e) => setNewLinkLabel(e.target.value)}
                        />
                        <input
                          className="w-full text-xs border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-1.5"
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

                  {(() => {
                    const channelMatch = { "나이스평가정보": "NICE", "KCB": "KCB" }[selected.orgName];
                    if (!channelMatch) return null;
                    const channelDeals = deals.filter((d) => d.dataChannel === channelMatch);
                    if (channelDeals.length === 0) return null;
                    return (
                      <div>
                        <div className="text-xs font-extrabold text-navy dark:text-gray-100 mb-2">{channelMatch} 데이터 연동 기업</div>
                        <div className="space-y-1.5">
                          {channelDeals.map((d) => (
                            <div
                              key={d.id}
                              onClick={() => openDeal(d)}
                              className="flex items-center justify-between text-xs bg-purple-50 hover:bg-purple-100 rounded-lg px-3 py-2 cursor-pointer"
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
          items = activeDeals.filter((d) => mapGroupName(d.orgGroup) === reportModal.key)
            .filter((d) => d.contractAmount)
            .sort((a, b) => (b.contractAmount || 0) - (a.contractAmount || 0));
        } else if (reportModal.type === "prob") {
          title = `계약가능성: ${reportModal.key}`;
          const known = ["상", "중", "하", "완료"];
          items = activeDeals.filter((d) => (known.includes(reportModal.key) ? d.probability === reportModal.key : !known.includes(d.probability)));
        } else if (reportModal.type === "probBucket") {
          const [bucket, sub] = reportModal.key.split(":");
          const labelMap = { quote: "견적", contract: "계약", drop: "드랍" };
          title = sub === "total" ? `${labelMap[bucket]} · 총합` : `${labelMap[bucket]} · ${sub}`;
          if (bucket === "quote") {
            items = sub === "total"
              ? activeDeals.filter((d) => ["상", "중", "하"].includes(d.probability))
              : activeDeals.filter((d) => d.probability === sub);
          } else if (bucket === "contract") {
            items = activeDeals.filter((d) => d.probability === "완료");
          } else if (bucket === "drop") {
            items = deals.filter((d) => droppedOrgNames.has((d.orgName || "").trim()) || d.probability === "드랍");
          }
          items = items.sort((a, b) => (b.expectedPerformance || 0) - (a.expectedPerformance || 0));
        } else if (reportModal.type === "month") {
          title = `${reportModal.key} 활동 내역`;
          const dealsById = {};
          activeDeals.forEach((d) => { dealsById[d.id] = d; });
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
                          <div className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">{a.text}</div>
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
                          {reportModal.type === "probBucket" && (
                            <span className="text-[10px] text-navy dark:text-gray-100 font-bold shrink-0 ml-2">
                              {formatWon(reportModal.key.startsWith("contract") ? d.contractAmount : d.expectedPerformance)}
                            </span>
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
                      <div className="text-[11px] text-gray-400 px-2 mb-1">{favCompanies.length}개 기업</div>
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

      {contractKpiModal && (() => {
        const thisMonth = todayLocalStr().slice(0, 7);
        const titleMap = { total: "전체 계약", within60: "60일 이내 갱신 예정", within30: "30일 이내 우선 확인", thisMonth: "이번 달 예상 갱신금액" };
        let items = contractRenewalList;
        if (contractKpiModal === "within60") items = contractRenewalList.filter((d) => d._daysLeft !== null && d._daysLeft > 30 && d._daysLeft <= 60);
        else if (contractKpiModal === "within30") items = contractRenewalList.filter((d) => d._daysLeft !== null && d._daysLeft >= 0 && d._daysLeft <= 30);
        else if (contractKpiModal === "thisMonth") items = contractRenewalList.filter((d) => (d.contractRenewalDate || "").slice(0, 7) === thisMonth);
        return (
          <>
            <div className="fixed inset-0 bg-navy-deep/40 z-50" onClick={() => setContractKpiModal(null)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <div className="bg-white dark:bg-[#111827] rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto pointer-events-auto shadow-2xl">
                <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-[#111827]">
                  <span className="text-sm font-extrabold text-navy dark:text-gray-100">{titleMap[contractKpiModal]}</span>
                  <button className="text-gray-400 hover:text-navy" onClick={() => setContractKpiModal(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-gray-400 px-2 mb-1">{items.length}건</div>
                  {items.map((d) => (
                    <div
                      key={d.id}
                      onClick={() => { openDeal(d); setContractKpiModal(null); }}
                      className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer"
                    >
                      <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100 min-w-0">
                        <LogoBadge name={d.orgName} /><span className="truncate">{d.orgName}</span>
                        <span className="text-gray-300 font-normal ml-1.5 shrink-0">{(d.targetProduct || "").replace(/\n/g, " ")}</span>
                      </div>
                      <span className={"text-[10px] px-1.5 py-0.5 rounded-md font-semibold shrink-0 ml-2 " + d._status.cls}>
                        {d._daysLeft === null ? "미설정" : `D${d._daysLeft < 0 ? "+" + Math.abs(d._daysLeft) : "-" + d._daysLeft}`}
                      </span>
                    </div>
                  ))}
                  {items.length === 0 && <div className="text-center text-xs text-gray-300 py-10">해당하는 계약이 없습니다.</div>}
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {groupRecencyModal && (() => {
        const items = activeDeals
          .filter((d) => mapGroupName(d.orgGroup) === groupRecencyModal.groupName && dealKpiCat[d.id]?.recency === groupRecencyModal.recency)
          .sort((a, b) => (lastActionByDeal[b.id] || "").localeCompare(lastActionByDeal[a.id] || ""));
        const info = RECENCY_LABEL[groupRecencyModal.recency];
        return (
          <>
            <div className="fixed inset-0 bg-navy-deep/40 z-50" onClick={() => setGroupRecencyModal(null)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <div className="bg-white dark:bg-[#111827] rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto pointer-events-auto shadow-2xl">
                <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-[#111827]">
                  <span className="text-sm font-extrabold text-navy dark:text-gray-100">{groupRecencyModal.groupName} · {info[0]}</span>
                  <button className="text-gray-400 hover:text-navy" onClick={() => setGroupRecencyModal(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-gray-400 px-2 mb-1">{items.length}건</div>
                  {items.map((d) => (
                    <div
                      key={d.id}
                      onClick={() => { openDeal(d); setGroupRecencyModal(null); }}
                      className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer"
                    >
                      <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100 min-w-0">
                        <LogoBadge name={d.orgName} /><span className="truncate">{d.orgName}</span>
                        <span className="text-gray-300 font-normal ml-1.5 shrink-0">{(d.targetProduct || "").replace(/\n/g, " ")}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0 ml-2">{lastActionByDeal[d.id] || ""}</span>
                    </div>
                  ))}
                  {items.length === 0 && <div className="text-center text-xs text-gray-300 py-10">해당하는 딜이 없습니다.</div>}
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {showDroppedModal && (
        <>
          <div className="fixed inset-0 bg-navy-deep/40 z-50" onClick={() => setShowDroppedModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white dark:bg-[#111827] rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto pointer-events-auto shadow-2xl">
              <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-[#111827]">
                <span className="text-sm font-extrabold text-gray-600 dark:text-gray-300">드랍 기업</span>
                <button className="text-gray-400 hover:text-navy" onClick={() => setShowDroppedModal(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-gray-400 px-2 mb-1">{droppedCompanyList.length}개 기업 — 산업군·업체현황 등 모든 화면에서 제외되어 있습니다.</div>
                {droppedCompanyList.map((o) => (
                  <div
                    key={o.name}
                    onClick={() => { openDeal(o.deals[0]); setShowDroppedModal(false); }}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer"
                  >
                    <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100 min-w-0">
                      <LogoBadge name={o.name} /><span className="truncate">{o.name}</span>
                      <span className="text-gray-300 font-normal ml-1.5 shrink-0">{o.group}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); restoreCompany(o.name); }}
                      className="text-[10px] bg-navy text-white px-2.5 py-1 rounded-lg font-semibold shrink-0 ml-2"
                    >
                      복구
                    </button>
                  </div>
                ))}
                {droppedCompanyList.length === 0 && (
                  <div className="text-center text-xs text-gray-300 py-10">드랍된 기업이 없습니다.</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {kpiModalKey && (() => {
        const def = KPI_DEFS.find((k) => k.key === kpiModalKey);
        let matched = deals.filter((d) => {
          if (kpiModalKey === "aiFlag") return !!d.aiFlag;
          const c = dealKpiCat[d.id];
          return c?.recency === kpiModalKey || c?.future === kpiModalKey;
        });
        // "액션 도래" 모달에는 오늘 다음 액션이 도래해 현재 액션으로 승격된 딜(더 이상 future==="actionDue"로 안 잡힘)도 포함시킨다.
        if (kpiModalKey === "actionDue") {
          todayPromotedDeals.forEach((d) => {
            if (!matched.some((x) => x.id === d.id)) matched.push(d);
          });
        }
        matched = matched.sort((a, b) =>
          ["actionDue", "actionPlanned"].includes(kpiModalKey)
            ? (dealKpiCat[a.id]?.futureDate || "").localeCompare(dealKpiCat[b.id]?.futureDate || "")
            : (lastActionByDeal[b.id] || "").localeCompare(lastActionByDeal[a.id] || "")
        );
        const todayStr = todayLocalStr();
        const todayItems =
          kpiModalKey === "actionDue"
            ? matched.filter((d) => dealKpiCat[d.id]?.futureDate === todayStr || todayPromotedInfo[d.id])
            : [];
        const restItems = kpiModalKey === "actionDue" ? matched.filter((d) => !todayItems.some((x) => x.id === d.id)) : matched;
        const itemReasonText = (d) => {
          if (["actionDue", "actionPlanned"].includes(kpiModalKey)) {
            return dealKpiCat[d.id]?.futureDate || (todayPromotedInfo[d.id] ? `오늘 · ${todayPromotedInfo[d.id]}` : "");
          }
          return lastActionByDeal[d.id] || "";
        };
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
                  {todayItems.length > 0 && (
                    <div className="mb-2 rounded-lg overflow-hidden border border-green-100 dark:border-green-900">
                      <div className="px-3 py-2 bg-green-50/50 dark:bg-green-950/20 flex items-center justify-between">
                        <span className="text-[11px] font-extrabold text-green-600 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />오늘 진행
                        </span>
                        <span className="text-[10px] text-gray-400">{todayItems.length}건</span>
                      </div>
                      {todayItems.map((d) => (
                        <div
                          key={d.id}
                          onClick={() => { openDeal(d); setKpiModalKey(null); }}
                          className="px-3 py-2.5 hover:bg-[#F8FAFC] dark:hover:bg-gray-800 cursor-pointer border-t border-[#F4F6F9] dark:border-gray-800"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center text-xs font-semibold text-navy dark:text-gray-100">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1.5 shrink-0" />
                              <LogoBadge name={d.orgName} />{d.orgName}
                              <span className="text-gray-300 font-normal ml-1.5">{(d.targetProduct || "").replace(/\n/g, " ")}</span>
                            </div>
                            <span className="text-[10px] text-green-600 shrink-0 ml-2">{itemReasonText(d)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[11px] text-gray-400 px-2 mb-1">{restItems.length}건</div>
                  {restItems.map((d) => (
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
                        <span className="text-[10px] text-gray-400 shrink-0 ml-2">{itemReasonText(d)}</span>
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
                    className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-3 py-2"
                    value={newDeal.orgGroup}
                    onChange={(e) => setNewDeal({ ...newDeal, orgGroup: e.target.value })}
                  >
                    {GROUP_ORDER.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">업체명 *</label>
                  <input className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-3 py-2" value={newDeal.orgName} onChange={(e) => setNewDeal({ ...newDeal, orgName: e.target.value })} />
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">타겟 제품</label>
                  {!newDealCustomProduct ? (
                    <select
                      className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-3 py-2"
                      value={newDeal.targetProduct}
                      onChange={(e) => {
                        if (e.target.value === "__custom__") {
                          setNewDealCustomProduct(true);
                          setNewDeal({ ...newDeal, targetProduct: "" });
                        } else {
                          setNewDeal({ ...newDeal, targetProduct: e.target.value });
                        }
                      }}
                    >
                      <option value="">-- 선택 --</option>
                      {uniqueTargetProducts.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                      <option value="__custom__">+ 직접 입력...</option>
                    </select>
                  ) : (
                    <div className="flex gap-1.5">
                      <input
                        className="flex-1 border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-3 py-2"
                        placeholder="새 타겟제품명 입력"
                        value={newDeal.targetProduct}
                        onChange={(e) => setNewDeal({ ...newDeal, targetProduct: e.target.value })}
                        autoFocus
                      />
                      <button
                        className="text-[11px] text-gray-400 px-2"
                        onClick={() => { setNewDealCustomProduct(false); setNewDeal({ ...newDeal, targetProduct: "" }); }}
                      >
                        목록에서 선택
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-gray-400 block mb-1">RM</label>
                    <input className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2" value={newDeal.rm} onChange={(e) => setNewDeal({ ...newDeal, rm: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">SO</label>
                    <input className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2" value={newDeal.so} onChange={(e) => setNewDeal({ ...newDeal, so: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">기대실적 (예: 3.1억원, 3000만원)</label>
                  <input className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-3 py-2" value={newDeal.expectedPerformanceRaw} onChange={(e) => setNewDeal({ ...newDeal, expectedPerformanceRaw: e.target.value })} />
                  {newDeal.expectedPerformanceRaw && (
                    <div className="text-[10px] text-gray-400 mt-1">
                      인식된 금액: {parseAmountKR(newDeal.expectedPerformanceRaw) !== null ? formatWon(parseAmountKR(newDeal.expectedPerformanceRaw)) : "인식 안됨(그냥 텍스트로만 저장)"}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-gray-400 block mb-1">계약목표</label>
                    <input className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2" placeholder="예: 12월" value={newDeal.contractGoal} onChange={(e) => setNewDeal({ ...newDeal, contractGoal: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">계약가능성</label>
                    <select className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2" value={newDeal.probability} onChange={(e) => setNewDeal({ ...newDeal, probability: e.target.value })}>
                      {["상", "중", "하", "완료"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">진행단계</label>
                    <select className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2" value={newDeal.stage} onChange={(e) => setNewDeal({ ...newDeal, stage: e.target.value })}>
                      {["1단계", "2단계", "3단계", "4단계"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">방문미팅</label>
                  <input className="w-full border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-3 py-2" value={newDeal.visitMeetingRaw} onChange={(e) => setNewDeal({ ...newDeal, visitMeetingRaw: e.target.value })} />
                </div>

                <div className="pt-2 border-t border-[#E7EAF0] dark:border-gray-700">
                  <label className="text-gray-400 block mb-1">최초 액션 (선택 — 입력하면 진행이력에 자동 추가)</label>
                  <div className="flex gap-2">
                    <input type="date" className="border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2 w-1/3" value={newDeal.firstActionDate} onChange={(e) => setNewDeal({ ...newDeal, firstActionDate: e.target.value })} />
                    <input className="border border-[#E7EAF0] dark:border-gray-700 rounded-lg px-2 py-2 flex-1" placeholder="예: 킥오프 미팅 진행" value={newDeal.firstActionText} onChange={(e) => setNewDeal({ ...newDeal, firstActionText: e.target.value })} />
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
