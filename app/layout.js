import "./globals.css";

export const metadata = {
  title: "Pipeline Dashboard",
  description: "테크핀레이팅스 세일즈 파이프라인 대시보드",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
