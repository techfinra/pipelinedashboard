'use client';

import { useEffect, useState } from "react";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { auth, googleProvider, ALLOWED_DOMAIN } from "../lib/firebase";

export default function Home() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email || "";
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await signOut(auth);
        setError(`${ALLOWED_DOMAIN} 계정으로만 로그인할 수 있습니다.`);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSignOut = () => signOut(auth);

  if (loading) {
    return <main style={{ padding: 40, fontFamily: "sans-serif" }}>로딩 중...</main>;
  }

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Pipeline Dashboard</h1>
      {!user ? (
        <div>
          <button onClick={handleSignIn}>Google로 로그인</button>
          {error && <p style={{ color: "red" }}>{error}</p>}
        </div>
      ) : (
        <div>
          <p>{user.email}님 환영합니다.</p>
          <button onClick={handleSignOut}>로그아웃</button>
          <p style={{ marginTop: 20, color: "#888" }}>
            대시보드 UI는 다음 단계에서 구현됩니다.
          </p>
        </div>
      )}
    </main>
  );
}
