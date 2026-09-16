'use client';

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
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

export default function Dashboard() {
  const [authChecked, setAuthChecked] = useState(false);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState("전체");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.href = "/";
        return;
      }
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    (async () => {
      try {
        const snap = await getDocs(collection(db, "deals"));
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setDeals(rows);
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
    const totalDeals = deals.length;
    const totalExpected = deals.reduce((a, d) => a + (d.expectedPerformance || 0), 0);
    const totalContract = deals.reduce((a, d) => a + (d.contractAmount || 0), 0);
    const stage4 = deals.filter((d) => (d.stage || "").includes("4")).length;
    return { totalDeals, totalExpected, totalContract, stage4 };
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
      <div style={{ padding: 40, fontFamily: "sans-serif" }}>
        로딩 중...
        {loadError && (
          <p style={{ color: "red", marginTop: 12 }}>에러: {loadError}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="dash-header">
        <h1>테크핀레이팅스 세일즈 파이프라인</h1>
        <button onClick={() => signOut(auth)}>로그아웃</button>
      </div>

      <div className="dash-body">
        <div className="kpi-row">
          <div className="kpi-card">
            <div className="kpi-num">{kpis.totalDeals}</div>
            <div className="kpi-label">전체 딜 건수</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-num">{formatWon(kpis.totalExpected)}</div>
            <div className="kpi-label">기대실적 합계</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-num">{formatWon(kpis.totalContract)}</div>
            <div className="kpi-label">계약금액 합계 (텍스트 추출분)</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-num">{kpis.stage4}</div>
            <div className="kpi-label">4단계(계약·운영) 건수</div>
          </div>
        </div>

        <div className="group-row">
          {groups.map((g) => (
            <div
              key={g}
              className={"group-chip" + (activeGroup === g ? " active" : "")}
              onClick={() => setActiveGroup(g)}
            >
              {g}
            </div>
          ))}
        </div>

        <input
          className="search-input"
          placeholder="업체명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <table className="deals">
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
                <td style={{ fontWeight: 700 }}>{d.orgName}</td>
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

      {selected && (
        <>
          <div className="panel-backdrop" onClick={() => setSelected(null)} />
          <div className="panel">
            <div className="panel-head">
              <button className="panel-close" onClick={() => setSelected(null)}>✕</button>
              <h2>{selected.orgName}</h2>
              <div style={{ fontSize: 12, color: "#6B7280" }}>
                {(selected.orgGroup || "").replace(/\n/g, " ")} · {(selected.targetProduct || "").replace(/\n/g, " ")}
              </div>
            </div>
            <div className="kv"><div className="kv-label">담당자</div><div>{selected.contactPerson || "-"}</div></div>
            <div className="kv"><div className="kv-label">RM / SO</div><div>{[selected.rm, selected.so].filter(Boolean).join(" / ") || "-"}</div></div>
            <div className="kv"><div className="kv-label">기대실적</div><div>{formatWon(selected.expectedPerformance)}</div></div>
            <div className="kv"><div className="kv-label">계약목표</div><div>{selected.contractGoal || "-"}</div></div>
            <div className="kv"><div className="kv-label">계약가능성</div><div><span className={probPillClass(selected.probability)}>{selected.probability || "-"}</span></div></div>
            <div className="kv"><div className="kv-label">진행단계</div><div>{selected.stage || "-"}</div></div>
            <div className="kv"><div className="kv-label">계약금액</div><div>{formatWon(selected.contractAmount)}</div></div>
            <div className="kv"><div className="kv-label">방문미팅</div><div>{selected.visitMeetingRaw || "-"}</div></div>

            <div style={{ padding: "16px 22px 6px", fontWeight: 800, fontSize: 13, color: "#0D1F4E" }}>
              진행 이력 ({activity.length})
            </div>
            {activity.map((a, i) => (
              <div className="activity-item" key={i}>
                <div className="activity-date">{a.date || "날짜 미상"}</div>
                <div>{a.text}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
