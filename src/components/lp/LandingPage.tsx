/**
 * @file components/lp/LandingPage.tsx
 * @description 広告から来た未ログインの人に見せる着地ページ（mywork#878）。スマホ 390px の1カラムが前提。
 * 画面の見本はここに書いたダミーの数字だけで描く（本人の家計データ・本番 DB は使わない）。
 */

import Link from "next/link";
import { LpViewBeacon } from "./LpViewBeacon";
import { WaitlistForm } from "./WaitlistForm";

const FEATURES = [
  { icon: "📅", title: "カレンダーで1か月の支出が見える", body: "日ごとの支出がマスに出るので、使いすぎた日がひと目で分かります。" },
  { icon: "💳", title: "クレカ明細をそのまま取り込み", body: "カード会社の CSV を入れるだけ。1件ずつ打ち込む手間がありません。" },
  { icon: "🔁", title: "サブスク・固定費を一覧に", body: "毎月の引き落としをまとめて見て、いらない契約に気づけます。" },
  { icon: "🧾", title: "レシートは写真で読み取り", body: "現金の買い物は撮るだけで金額と日付を入れます。" },
];

// ダミーの1か月（見本用。実在のデータではない）
const DEMO_DAYS: (number | null)[] = [
  null, null, 1280, 0, 3400, 560, 0,
  8200, 0, 1450, 720, 0, 2300, 4100,
  0, 980, 0, 12800, 640, 0, 3000,
  1500, 0, 0, 2750, 430, 6100, 0,
  870, 0, 1980,
];

function DemoCalendar() {
  return (
    <figure className="rounded-2xl bg-white p-3 shadow-md" aria-label="画面の見本（ダミーデータ）">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <span className="text-sm font-bold text-gray-900">11月</span>
        <span className="text-xs text-gray-500">支出 <b className="text-base text-gray-900">¥59,620</b></span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
        {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
          <div key={w} className="text-gray-400">{w}</div>
        ))}
        {DEMO_DAYS.map((v, i) => (
          <div key={i} className={`rounded-md py-1 ${v === null ? "" : v >= 5000 ? "bg-red-50" : "bg-gray-50"}`}>
            {v !== null && (
              <>
                <div className="text-gray-500">{i - 1}</div>
                <div className={`font-medium ${v >= 5000 ? "text-red-600" : "text-gray-800"}`}>{v ? v.toLocaleString() : "-"}</div>
              </>
            )}
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-center text-[10px] text-gray-400">画面の見本（数字はダミーです）</figcaption>
    </figure>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50">
      <LpViewBeacon />
      <main className="mx-auto max-w-md space-y-8 px-4 py-8">
        <section className="space-y-4 text-center">
          <p className="text-sm font-medium text-blue-700">カレンダー家計簿</p>
          <h1 className="text-2xl font-bold leading-snug text-gray-900">
            打ち込まない家計簿。<br />1か月の支出がカレンダーで見える
          </h1>
          <p className="text-sm text-gray-600">クレカ明細を入れるだけで、毎日の支出・サブスク・固定費が並びます。</p>
          <a href="#waitlist" className="inline-block w-full rounded-lg bg-blue-600 py-3 text-base font-bold text-white">
            公開のお知らせを受け取る
          </a>
        </section>

        <DemoCalendar />

        <section className="space-y-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex gap-3 rounded-xl bg-white p-4 shadow-sm">
              <span className="text-2xl" aria-hidden>{f.icon}</span>
              <div>
                <h2 className="text-base font-bold text-gray-900">{f.title}</h2>
                <p className="mt-1 text-sm text-gray-600">{f.body}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-center text-lg font-bold text-gray-900">いまは準備中です</h2>
          <p className="text-center text-sm text-gray-600">公開したらメールで1回だけお知らせします。</p>
          <WaitlistForm id="waitlist" />
        </section>

        <footer className="flex justify-center gap-4 pb-4 text-xs text-gray-500">
          <Link href="/about/terms" className="hover:underline">利用規約</Link>
          <Link href="/about/privacy" className="hover:underline">プライバシー</Link>
          <Link href="/login" className="hover:underline">ログイン</Link>
        </footer>
      </main>
    </div>
  );
}
