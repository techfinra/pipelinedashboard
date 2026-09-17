'use client';

import { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";

const EMAIL_DOMAIN = "techfinratings.com";
const DIVISIONS = ["경영본부", "사업성장본부", "고객솔루션본부", "CB본부", "ICT본부", "법무실"];

const S = {
  wrap: { padding: 40, fontFamily: "sans-serif", maxWidth: 360 },
  title: { marginBottom: 16 },
  input: { display: "block", width: "100%", padding: 10, marginBottom: 10, border: "1px solid #ddd", borderRadius: 8, fontSize: 14 },
  button: { width: "100%", padding: 10, background: "#0D1F4E", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 },
  error: { color: "red", marginTop: 10, fontSize: 13 },
  link: { marginTop: 14, fontSize: 13 },
};

export default function Signup() {
  const [accessCode, setAccessCode] = useState("");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [division, setDivision] = useState(DIVISIONS[0]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!accessCode || !id || !password || !name || !department) {
      setError("모든 항목을 입력해주세요.");
      return;
    }
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    setSubmitting(true);
    try {
      const codeRes = await fetch("/api/check-signup-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: accessCode }),
      });
      const codeData = await codeRes.json();
      if (!codeRes.ok) {
        setError(codeData.error || "승인 코드가 올바르지 않습니다.");
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, `${id}@${EMAIL_DOMAIN}`, password);
      await setDoc(doc(db, "users", cred.user.uid), {
        loginId: id,
        name,
        department,
        division,
        createdAt: serverTimestamp(),
      });
      setDone(true);
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 600);
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        setError("이미 사용 중인 아이디입니다.");
      } else if (e.code === "auth/invalid-email") {
        setError("아이디에 특수문자나 공백을 쓸 수 없습니다.");
      } else {
        setError(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return <main style={S.wrap}>가입 완료. 대시보드로 이동 중...</main>;
  }

  return (
    <main style={S.wrap}>
      <h1 style={S.title}>회원가입</h1>
      <input style={S.input} placeholder="승인 코드" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} />
      <input style={S.input} placeholder="아이디" value={id} onChange={(e) => setId(e.target.value)} />
      <input style={S.input} type="password" placeholder="비밀번호 (6자 이상)" value={password} onChange={(e) => setPassword(e.target.value)} />
      <input style={S.input} placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={S.input} placeholder="부서" value={department} onChange={(e) => setDepartment(e.target.value)} />
      <select style={S.input} value={division} onChange={(e) => setDivision(e.target.value)}>
        {DIVISIONS.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <button style={S.button} onClick={handleSubmit} disabled={submitting}>
        {submitting ? "처리 중..." : "가입하기"}
      </button>
      {error && <p style={S.error}>{error}</p>}
      <p style={S.link}>
        <a href="/">이미 계정이 있으신가요? 로그인</a>
      </p>
    </main>
  );
}
