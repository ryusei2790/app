/**
 * @file app/about/legal/page.tsx
 * @description 特定商取引法に基づく表記（mywork#970）。ログイン前でも読める。
 */

export const metadata = { title: "特定商取引法に基づく表記 — カレンダー家計簿" };

const ROWS: [string, string][] = [
  ["販売事業者", "frural（上田琉聖）"],
  ["運営責任者", "上田琉聖"],
  ["所在地・電話番号", "請求があれば遅滞なく開示します"],
  ["問い合わせ", "https://frural.jp/contact"],
  ["販売価格", "月額300円（税込）"],
  ["商品代金以外の必要料金", "通信料はお客様の負担です"],
  ["支払い方法", "クレジットカード（Stripe）"],
  ["支払い時期", "申し込み時に初回、以後1か月ごとに自動で請求します"],
  ["提供時期", "決済の完了後すぐに使えます"],
  ["解約", "設定の「プラン」からいつでも解約でき、支払い済みの期間の終わりまで使えます"],
  ["返品・返金", "サービスの性質上、支払い済みの料金の返金はしません"],
];

export default function LegalPage() {
  return (
    <article className="space-y-4 text-sm text-gray-800">
      <h1 className="text-xl font-bold">特定商取引法に基づく表記</h1>
      <dl className="divide-y divide-gray-200">
        {ROWS.map(([k, v]) => (
          <div key={k} className="py-2">
            <dt className="font-semibold">{k}</dt>
            <dd className="text-gray-700">{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
