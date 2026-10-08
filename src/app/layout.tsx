/**
 * @file app/layout.tsx
 * @description アプリ全体のルートレイアウト。
 * フォント・メタデータ・グローバルスタイルを設定する。
 */

import type { Metadata, Viewport } from "next";
import { THEME_COLOR } from "./manifest";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "カレンダー型家計簿",
  description: "入力を最小化した、クレカCSV連携カレンダー型家計簿",
  // PWA: iPhone でホーム画面に置いたときの名前・アイコン・全画面表示（manifest は app/manifest.ts）
  appleWebApp: { capable: true, title: "家計簿", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
