'use client';

import { useEffect, useState } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";

const EMAIL_DOMAIN = "techfinratings.com";

const S = {
  wrap: { padding: 40, fontFamily: "sans-serif", maxWidth: 360 },
  title: { marginBottom: 4 },
  sub: { color: "#666", marginBottom: 16 },
  input: { display: "block", width: "100%", padding: 10, marginBottom: 10, border: "1px solid #ddd", borderRadius: 8, fontSize: 14 },
  button: { width: "100%", padding: 10, background: "#0D1F4E", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 },
  error: { color: "red", marginTop: 10, fontSize: 13 },
  link: { marginTop: 14, fontSize: 13 },
};

export default function Home() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleLogin = async () => {
    setError("");
    if (!id || !password) {
      setError("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, `${id}@${EMAIL_DOMAIN}`, password);
    } catch (e) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleLogin();
  };

  if (loading) {
    return <main style={S.wrap}>로딩 중...</main>;
  }

  if (user) {
    if (typeof window !== "undefined") {
      window.location.href = "/dashboard";
    }
    return <main style={S.wrap}>로그인 완료. 대시보드로 이동 중...</main>;
  }

  return (
    <main style={S.wrap}>
      <h1 style={S.title}>Pipeline Dashboard</h1>
      <p style={S.sub}>아이디와 비밀번호를 입력하세요.</p>
      <input
        style={S.input}
        placeholder="아이디"
        value={id}
        onChange={(e) => setId(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <input
        style={S.input}
        type="password"
        placeholder="비밀번호"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button style={S.button} onClick={handleLogin} disabled={submitting}>
        {submitting ? "로그인 중..." : "로그인"}
      </button>
      {error && <p style={S.error}>{error}</p>}
      <p style={S.link}>
        <a href="/signup">계정이 없으신가요? 회원가입</a>
      </p>
    </main>
  );
}
