/**
 * @file app/about/definitions/page.tsx
 * @description 「数字の定義」のページ（Server Component。mywork#425 第1弾、設計書 4-6）。
 * 集計の定義10項目・分かっている限界・回帰テストが最後に一致した日を、lib/aggregate/definitions.ts と
 * scripts/regression/expected.json から出す。ログイン前でも読める（本人以外が見ても家計の数字は何も無い）。
 * 画面のカードの脚注と同じ文言（definitions.ts）を使うので、画面とこのページが食い違わない（D10）。
 */

import type { Metadata } from "next";
import expected from "../../../../scripts/regression/expected.json";
import { DEFINITIONS, DEFINITIONS_VERSION, FOOTNOTES, KNOWN_LIMITS } from "@/lib/aggregate/definitions";

export const metadata: Metadata = {
  title: "数字の定義 | カレンダー型家計簿",
  description: "この家計簿が「支出」「収入」「今月」「予定」などをどう数えているかの定義と、分かっている限界",
};

const regression = expected as {
  definitions_version: string;
  today: string | null;
  months: number;
  rows: number;
  sha256: string | null;
  generated_at: string | null;
};

function jstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "/");
}

export default function DefinitionsPage() {
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">数字の定義</h1>
        <p className="mt-2 text-sm text-gray-600">
          この家計簿のどの画面でも、数字は同じ1つの計算（<code className="rounded bg-gray-100 px-1">lib/aggregate</code>）から出しています。
          何をどう数えているかをここに書いておき、画面の脚注も同じ文言を使います。定義の版: <span className="tabular-nums">{DEFINITIONS_VERSION}</span>
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">用語と計算</h2>
        <ul className="space-y-3">
          {DEFINITIONS.map((d) => (
            <li key={d.id} className="rounded-xl border border-gray-200 bg-white p-4" id={d.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-base font-semibold text-gray-900">{d.term}</h3>
                {d.phase && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">第{d.phase}弾で画面に出ます</span>}
              </div>
              <p className="mt-1 text-sm text-gray-800">{d.text}</p>
              <dl className="mt-2 grid grid-cols-[4em_1fr] gap-x-2 gap-y-0.5 text-xs text-gray-600">
                <dt className="text-gray-500">計算</dt>
                <dd className="font-mono text-[11px] leading-relaxed">{d.formula}</dd>
                <dt className="text-gray-500">使う画面</dt>
                <dd>{d.where}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">画面に出ている脚注</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>{FOOTNOTES.expense}</li>
          <li>{FOOTNOTES.income}</li>
          <li>{FOOTNOTES.period}</li>
          <li>{FOOTNOTES.scheduled}</li>
          <li>{FOOTNOTES.fixed}</li>
          <li>{FOOTNOTES.memo}</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">分かっている限界</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          {KNOWN_LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4" data-testid="regression-status">
        <h2 className="text-base font-semibold text-gray-900">本物の帳簿での検算</h2>
        {regression.sha256 && regression.generated_at ? (
          <p className="text-sm text-gray-700">
            本人の帳簿（CSV、{regression.rows.toLocaleString("ja-JP")}行・{regression.months}か月）で、月ごとの支出・収入・返金・予定・固定／変動・費目が
            前回と1円単位で一致することを確かめています。最後に一致を確かめた日: <span className="tabular-nums">{jstDate(regression.generated_at)}</span>
            （基準日 {regression.today}、定義の版 {regression.definitions_version}）。金額そのものは公開していません（ハッシュだけ）。
          </p>
        ) : (
          <p className="text-sm text-gray-700">まだ回していません。</p>
        )}
      </section>

      <p className="text-xs text-gray-500">
        何がどこへ送られるかは、ログイン後の「設定 → データの流れ」にあります。この定義は Pulse Local（pulseos.finance）の「数字はコードで計算し、定義と限界を隠さない」という作り方を参考にしています。
      </p>
    </article>
  );
}
