'use client';

import { useEffect, useState } from "react";
import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, ALLOWED_DOMAIN, getActionCodeSettings } from "../lib/firebase";

const EMAIL_STORAGE_KEY = "pipelineDashboardEmailForSignIn";

export default function Home() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isSignInWithEmailLink(auth, window.location.href)) {
      const storedEmail = window.localStorage.getItem(EMAIL_STORAGE_KEY);
      if (!storedEmail) {
        setNeedsEmailConfirm(true);
        return;
      }
      completeSignIn(storedEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeSignIn = async (targetEmail) => {
    try {
      await signInWithEmailLink(auth, targetEmail, window.location.href);
      window.localStorage.removeItem(EMAIL_STORAGE_KEY);
      window.history.replaceState({}, document.title, window.location.pathname);
      setNeedsEmailConfirm(false);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSendLink = async () => {
    setError("");
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setError(`${ALLOWED_DOMAIN} 계정으로만 로그인할 수 있습니다.`);
      return;
    }
    try {
      await sendSignInLinkToEmail(auth, email, getActionCodeSettings());
      window.localStorage.setItem(EMAIL_STORAGE_KEY, email);
      setLinkSent(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleConfirmEmail = () => {
    setError("");
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setError(`${ALLOWED_DOMAIN} 계정으로만 로그인할 수 있습니다.`);
      return;
    }
    completeSignIn(email);
  };

  const handleSignOut = () => signOut(auth);

  if (loading) {
    return <main style={{ padding: 40, fontFamily: "sans-serif" }}>로딩 중...</main>;
  }

  if (user) {
    return (
      <main style={{ padding: 40, fontFamily: "sans-serif" }}>
        <h1>Pipeline Dashboard</h1>
        <p>{user.email}님 환영합니다.</p>
        <button onClick={handleSignOut}>로그아웃</button>
        <p style={{ marginTop: 20, color: "#888" }}>
          대시보드 UI는 다음 단계에서 구현됩니다.
        </p>
      </main>
    );
  }

  if (needsEmailConfirm) {
    return (
      <main style={{ padding: 40, fontFamily: "sans-serif" }}>
        <h1>Pipeline Dashboard</h1>
        <p>로그인을 완료하려면 이메일 주소를 다시 확인해주세요.</p>
        <input
          type="email"
          placeholder={`you@${ALLOWED_DOMAIN}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 8, width: 280, marginRight: 8 }}
        />
        <button onClick={handleConfirmEmail}>확인</button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </main>
    );
  }

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Pipeline Dashboard</h1>
      {linkSent ? (
        <p>{email}로 로그인 링크를 보냈습니다. 메일함을 확인해주세요.</p>
      ) : (
        <div>
          <input
            type="email"
            placeholder={`you@${ALLOWED_DOMAIN}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 8, width: 280, marginRight: 8 }}
          />
          <button onClick={handleSendLink}>로그인 링크 받기</button>
          {error && <p style={{ color: "red" }}>{error}</p>}
        </div>
      )}
    </main>
  );
}
