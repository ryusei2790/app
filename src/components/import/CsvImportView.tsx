/**
 * @file components/import/CsvImportView.tsx
 * @description CSVインポート画面（Client Component）。
 * ① CSV を選ぶ → 1行目で形式を判定
 *   - 家計簿アプリ形式（金額,日付,メモ,カテゴリー名）… ② 取り込み先の口座 → ③「内容を確認」（保存しない）
 *       → 内訳（新規・取り込み済み・定期で作成済み・予定・読めない行）と、予定の行を「定期にする」か選ぶ → ④「取り込む」
 *       何回入れても増えない（サーバーが行の目印で判定）ので、移行中に何度書き出して入れ直してもよい
 *   - それ以外 … カード会社（エポス・セゾン）を選んで従来どおり「インポート実行」
 * インポート履歴も下部に表示する。CSV の中身はこの画面とサーバーの間でしかやり取りしない。
 */

"use client";

import Link from "next/link";
import { HelpLink } from "@/components/help/HelpLink";
import { useState, useRef, useCallback } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { decodeCsv } from "@/lib/csv/decode";
import { detectFormat } from "@/lib/csv/kakebo";
import { ImportHistoryList } from "./ImportHistoryList";
import { errorMessage } from "@/lib/errors/api-error";

type CardType = "epos" | "saison";
type Format = "kakebo" | "card";
type ImportStatus = "idle" | "loading" | "success" | "error";

interface CardImportResult {
  import_id: string;
  imported_count: number;
  skipped_count: number;
  preview: Array<{ transaction_date: string; note: string; amount: number }>;
}

interface FutureRow {
  key: string;
  date: string;
  amount: number;
  type: "income" | "expense";
  note: string;
  category_name: string;
  billing_day: number;
  already_scheduled: boolean;
}

interface KakeboPreview {
  counts: { fresh: number; already: number; recurring_done: number; future: number; invalid: number };
  future: FutureRow[];
  invalid: Array<{ line: number; reason: string }>;
}

interface KakeboResult {
  imported_count: number;
  skipped_count: number;
  scheduled_count: number;
}

const NEW_ACCOUNT = "new";
const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/**
 * ファイルの1行目だけを読んで形式を判定する。
 * 先頭の数KBを丸ごと decode すると、マルチバイト文字の途中で切れて UTF-8 判定を誤るので、最初の改行までにする。
 */
async function detectFileFormat(file: File): Promise<Format> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const nl = head.indexOf(0x0a);
  const firstLine = decodeCsv(nl >= 0 ? head.slice(0, nl) : head);
  return detectFormat(firstLine) === "kakebo" ? "kakebo" : "card";
}

/**
 * @param isOwner 社長なら、取り込み後に「予算台帳で見る」を出す（予算台帳は社長専用: S6）
 */
export function CsvImportView({ isOwner = false }: { isOwner?: boolean }) {
  const { accounts } = useAccounts();
  const [format, setFormat] = useState<Format | null>(null);
  const [cardType, setCardType] = useState<CardType>("epos");
  const [accountId, setAccountId] = useState(NEW_ACCOUNT);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [cardResult, setCardResult] = useState<CardImportResult | null>(null);
  const [preview, setPreview] = useState<KakeboPreview | null>(null);
  const [schedule, setSchedule] = useState<Set<string>>(new Set());
  const [kakeboResult, setKakeboResult] = useState<KakeboResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 取り込みが終わるたびに履歴（ImportHistoryList）を取り直すための番号
  const [historyKey, setHistoryKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** ファイルを選んだら、前の結果を消して形式を判定する */
  const chooseFile = useCallback(async (f: File) => {
    setFile(f);
    setCardResult(null);
    setKakeboResult(null);
    setPreview(null);
    setErrorMsg(null);
    setStatus("idle");
    const detected = await detectFileFormat(f);
    setFormat(detected);
    // カード形式は既存の口座を選んでもらう（「新しく作る」は家計簿アプリ形式だけ）
    setAccountId((cur) => (detected === "card" && cur === NEW_ACCOUNT ? "" : cur));
  }, []);

  // ドラッグ&ドロップ処理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback(() => setIsDragging(false), []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped?.name.toLowerCase().endsWith(".csv")) void chooseFile(dropped);
    },
    [chooseFile]
  );

  /** 共通: フォームを送って JSON を返す。失敗ならエラーを投げる */
  async function post(form: FormData) {
    const res = await fetch("/api/v1/import", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "インポートに失敗しました");
    return json.data;
  }

  /** 家計簿アプリ形式: ③ 内容を確認（保存しない） */
  async function handlePreview() {
    if (!file) return;
    setStatus("loading");
    setErrorMsg(null);
    const form = new FormData();
    form.append("file", file);
    form.append("mode", "preview");
    try {
      const data: KakeboPreview = await post(form);
      setPreview(data);
      // 初期値: 登録済みでない予定は全部「定期にする」
      setSchedule(new Set(data.future.filter((f) => !f.already_scheduled).map((f) => f.key)));
      setStatus("idle");
    } catch (e) {
      setErrorMsg(errorMessage(e, "不明なエラー"));
      setStatus("error");
    }
  }

  /** 家計簿アプリ形式: ④ 取り込む（サーバーは計画を作り直すので、確認後に別の取り込みがあっても増えない） */
  async function handleCommit() {
    if (!file || !accountId) return;
    setStatus("loading");
    setErrorMsg(null);
    const form = new FormData();
    form.append("file", file);
    form.append("mode", "commit");
    form.append("account_id", accountId);
    form.append("schedule_keys", JSON.stringify([...schedule]));
    try {
      setKakeboResult(await post(form));
      setHistoryKey((n) => n + 1);
      setPreview(null);
      setStatus("success");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setErrorMsg(errorMessage(e, "不明なエラー"));
      setStatus("error");
    }
  }

  /** カード会社の CSV: 従来どおり一括で取り込む */
  async function handleCardImport() {
    if (!file || !accountId) {
      setErrorMsg("口座を選択してCSVファイルを選んでください");
      return;
    }
    setStatus("loading");
    setErrorMsg(null);
    const form = new FormData();
    form.append("file", file);
    form.append("account_id", accountId);
    form.append("card_type", cardType);
    try {
      setCardResult(await post(form));
      setHistoryKey((n) => n + 1);
      setStatus("success");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setErrorMsg(errorMessage(e, "不明なエラー"));
      setStatus("error");
    }
  }

  function toggleSchedule(key: string, on: boolean) {
    setSchedule((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">CSVインポート <HelpLink section="import" /></h2>

      <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        {/* ① ファイル */}
        <div>
          <label htmlFor="csv-file" className="mb-2 block text-sm font-medium text-gray-700">
            CSVファイル
          </label>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              isDragging
                ? "border-blue-400 bg-blue-50"
                : file
                  ? "border-green-400 bg-green-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <input
              id="csv-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void chooseFile(f);
              }}
            />
            {file ? (
              <div>
                <p className="break-all text-sm font-medium text-green-700">{file.name}</p>
                <p className="mt-1 text-xs text-green-600">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500">タップして CSV を選ぶ</p>
                <p className="mt-1 text-xs text-gray-400">家計簿アプリの書き出し・エポス・セゾンに対応</p>
              </div>
            )}
          </div>
          {file && format && (
            <p data-testid="import-format" className="mt-2 text-xs text-gray-600">
              形式: {format === "kakebo" ? "家計簿アプリ（金額,日付,メモ,カテゴリー名）" : "カード会社の明細"}
            </p>
          )}
        </div>

        {/* カード会社（家計簿アプリ形式でないときだけ） */}
        {format === "card" && (
          <div>
            <p className="mb-2 block text-sm font-medium text-gray-700">カード会社</p>
            <div className="flex gap-3">
              {(["epos", "saison"] as CardType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setCardType(type)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    cardType === type ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {type === "epos" ? "エポスカード" : "セゾンカード"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ② 口座 */}
        {format && (
          <div>
            <label htmlFor="import-account" className="mb-2 block text-sm font-medium text-gray-700">
              取り込み先の口座
            </label>
            <select
              id="import-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {format === "kakebo" ? (
                <option value={NEW_ACCOUNT}>「家計簿アプリ（移行）」（無ければ作る）</option>
              ) : (
                <option value="">口座を選択してください</option>
              )}
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {errorMsg && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMsg}</div>}

        {/* ③ 内容を確認 ／ カードは一括 */}
        {format === "kakebo" && !preview && (
          <button
            type="button"
            onClick={handlePreview}
            disabled={!file || status === "loading"}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" ? "確認中..." : "内容を確認"}
          </button>
        )}
        {format === "card" && (
          <button
            type="button"
            onClick={handleCardImport}
            disabled={!file || !accountId || status === "loading"}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" ? "インポート中..." : "インポート実行"}
          </button>
        )}
      </div>

      {/* 家計簿アプリ形式の確認画面 */}
      {preview && (
        <div className="space-y-4 rounded-xl border border-blue-200 bg-white p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-gray-800">取り込む内容</h3>
          <ul data-testid="import-counts" className="grid grid-cols-2 gap-2 text-sm">
            <li className="rounded bg-blue-50 px-3 py-2 font-medium text-blue-800">新規 {preview.counts.fresh}件</li>
            <li className="rounded bg-gray-50 px-3 py-2 text-gray-600">取り込み済み {preview.counts.already}件</li>
            <li className="rounded bg-gray-50 px-3 py-2 text-gray-600">定期で作成済み {preview.counts.recurring_done}件</li>
            <li className="rounded bg-gray-50 px-3 py-2 text-gray-600">予定 {preview.counts.future}件</li>
            <li className={`col-span-2 rounded px-3 py-2 ${preview.counts.invalid > 0 ? "bg-amber-50 text-amber-800" : "bg-gray-50 text-gray-600"}`}>
              読めない行 {preview.counts.invalid}件
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            取り込み済みの行は何回入れても増えません。同じ日に同じ買い物が2回ある行は2件とも入ります。
          </p>

          {preview.future.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">先の日付の行（予定）を毎月の定期にしますか？</p>
              <p className="mb-2 text-xs text-gray-500">予定は取引にはしません。チェックした行は「毎月・その日」の定期になり、日付が来たら自動で取引になります。</p>
              <ul className="divide-y divide-gray-100 rounded border border-gray-100">
                {preview.future.map((f) => (
                  <li key={f.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      id={`sch-${f.key}`}
                      type="checkbox"
                      className="h-5 w-5 shrink-0"
                      disabled={f.already_scheduled}
                      checked={schedule.has(f.key)}
                      onChange={(e) => toggleSchedule(f.key, e.target.checked)}
                    />
                    <label htmlFor={`sch-${f.key}`} className="min-w-0 flex-1">
                      <span className="block truncate">
                        {f.category_name || "（カテゴリーなし）"}
                        {f.note && f.note !== f.category_name ? ` ${f.note}` : ""}
                      </span>
                      <span className="block text-xs text-gray-500">
                        毎月{f.billing_day}日・{f.type === "income" ? "収入" : "支出"} {yen(f.amount)}（{f.date} から）
                        {f.already_scheduled ? "・登録済み" : ""}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.invalid.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-amber-800">読めない行（取り込みません）</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-amber-800">
                {preview.invalid.map((e) => (
                  <li key={e.line}>
                    {e.line}行目: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              やめる
            </button>
            <button
              type="button"
              onClick={handleCommit}
              disabled={status === "loading" || (preview.counts.fresh === 0 && schedule.size === 0)}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "loading" ? "取り込み中..." : "取り込む"}
            </button>
          </div>
        </div>
      )}

      {/* 家計簿アプリ形式の結果 */}
      {status === "success" && kakeboResult && (
        <div data-testid="import-result" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 sm:p-6">
          <p className="font-semibold">✓ {kakeboResult.imported_count}件を取り込みました</p>
          <p className="mt-1">
            とばした {kakeboResult.skipped_count}件（取り込み済み・定期で作成済み）・定期 {kakeboResult.scheduled_count}件
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href="/transactions" className="rounded-lg border border-green-300 bg-white px-3 py-1.5 text-green-800">
              収支一覧を見る
            </Link>
            <Link href="/review" className="rounded-lg border border-green-300 bg-white px-3 py-1.5 text-green-800">
              要確認を見る（返金候補など）
            </Link>
            {isOwner && (
              <Link href="/budget" className="rounded-lg bg-green-700 px-3 py-1.5 text-white">
                予算台帳で見る →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* カード会社の結果 */}
      {status === "success" && cardResult && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6">
          <h3 className="mb-3 text-sm font-semibold text-green-800">✓ インポート完了</h3>
          <div className="mb-4 flex gap-6 text-sm text-green-700">
            <span>
              取り込み: <strong>{cardResult.imported_count} 件</strong>
            </span>
            <span>
              スキップ: <strong>{cardResult.skipped_count} 件</strong>
            </span>
          </div>
          {cardResult.preview.length > 0 && (
            <ul className="space-y-1">
              {cardResult.preview.map((row, i) => (
                <li key={i} className="flex justify-between rounded bg-white px-3 py-1.5 text-xs text-green-800">
                  <span>{row.transaction_date}</span>
                  <span className="flex-1 truncate px-3">{row.note}</span>
                  <span className="font-medium">{yen(row.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* インポート履歴（取り消しもここから。mywork#425 第2弾） */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-800">インポート履歴</h3>
        <ImportHistoryList reloadKey={historyKey} />
      </div>
    </div>
  );
}
