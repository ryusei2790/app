/**
 * @file components/settings/DataFlowTable.tsx
 * @description 「何が外に出るか」の表（mywork#425 第1弾、設計書 4-7。Pulse Local の「Network activity」の表と同じ考え方）。
 * 内容は lib/aggregate/definitions.ts の DATA_FLOW・NOT_SENT・FUNCTION_REGION（コードの送信先と食い違わないよう S13 で照合）。
 * スマホ幅では1行＝1カードで読む。
 */

import Link from "next/link";
import { DATA_FLOW, DEFINITIONS_PATH, FUNCTION_REGION, NOT_SENT } from "@/lib/aggregate/definitions";

export function DataFlowTable() {
  return (
    <div className="space-y-4" data-testid="data-flow">
      <p className="text-sm text-gray-600">
        あなたの家計の記録が、どの操作でどこを通り、どこに残るかの一覧です。表はコードから作っていて、
        コードに表に無い送信先を足すとテストが落ちます。
      </p>

      <ul className="space-y-2">
        {DATA_FLOW.map((row) => (
          <li key={row.operation} className={`rounded-xl border p-3 ${row.planned ? "border-dashed border-gray-300 bg-gray-50" : "border-gray-200 bg-white"}`}>
            <p className="text-sm font-semibold text-gray-900">
              {row.operation}
              {row.planned && <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">まだ無い機能</span>}
            </p>
            <dl className="mt-1 grid grid-cols-[5em_1fr] gap-x-2 gap-y-0.5 text-xs text-gray-700">
              <dt className="text-gray-500">出るもの</dt>
              <dd>{row.leaves}</dd>
              <dt className="text-gray-500">経由</dt>
              <dd>{row.via}</dd>
              <dt className="text-gray-500">残るもの</dt>
              <dd>{row.storedAt}</dd>
              <dt className="text-gray-500">AI 提供元</dt>
              <dd>{row.externalAi}</dd>
              {row.hosts.length > 0 && (
                <>
                  <dt className="text-gray-500">送信先</dt>
                  <dd className="font-mono text-[11px]">{row.hosts.join("、")}</dd>
                </>
              )}
            </dl>
          </li>
        ))}
      </ul>

      <section className="rounded-xl border border-gray-200 bg-white p-3">
        <h4 className="text-sm font-semibold text-gray-900">どの操作でも外に出さないもの</h4>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-gray-700">
          {NOT_SENT.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700">
        <h4 className="text-sm font-semibold text-gray-900">サーバーの場所</h4>
        <p className="mt-1">
          データベース（Supabase）は東京。アプリの関数（Vercel）は <strong>{FUNCTION_REGION.label}</strong>。{FUNCTION_REGION.note}
        </p>
      </section>

      <p className="text-xs text-gray-500">
        数字の意味は{" "}
        <Link href={DEFINITIONS_PATH} className="text-blue-600 hover:underline">
          定義のページ
        </Link>
        {" "}に書いてあります。
      </p>
    </div>
  );
}
