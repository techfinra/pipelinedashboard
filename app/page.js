'use client';

import { useEffect, useState } from "react";
import { signInWithCustomToken, signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";

export default function Home() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleVerify = async () => {
    setError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          (data.error || "인증에 실패했습니다.") +
            (data.debug ? " | debug: " + JSON.stringify(data.debug) : "")
        );
        return;
      }
      await signInWithCustomToken(auth, data.token);
    } catch (e) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleSignOut = () => signOut(auth);

  if (loading) {
    return <main style={{ padding: 40, fontFamily: "sans-serif" }}>로딩 중...</main>;
  }

  if (user) {
    if (typeof window !== "undefined") {
      window.location.href = "/dashboard.html";
    }
    return (
      <main style={{ padding: 40, fontFamily: "sans-serif" }}>
        <p>인증 완료. 대시보드로 이동 중...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Pipeline Dashboard</h1>
      <p style={{ marginBottom: 16 }}>승인 코드를 입력하세요.</p>
      <input
        type="password"
        placeholder="승인 코드"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleVerify();
        }}
        style={{ padding: 8, width: 200, marginRight: 8 }}
      />
      <button onClick={handleVerify} disabled={verifying}>
        {verifying ? "확인 중..." : "확인"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
