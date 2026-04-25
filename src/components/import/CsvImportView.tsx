/**
 * @file components/import/CsvImportView.tsx
 * @description CSVインポート画面（Client Component）。
 * ① カード種別・口座を選択 → ② ファイルをドロップ/選択 → ③ インポート実行 → ④ 結果表示
 * インポート履歴も下部に表示する。
 */

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useAccounts } from "@/hooks/useAccounts";

type CardType = "epos" | "saison";
type ImportStatus = "idle" | "loading" | "success" | "error";

interface ImportResult {
  import_id: string;
  imported_count: number;
  skipped_count: number;
  preview: Array<{ transaction_date: string; note: string; amount: number }>;
}

interface ImportHistory {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  imported_at: string;
  account: { id: string; name: string };
}

export function CsvImportView() {
  const { accounts } = useAccounts();
  const [cardType, setCardType] = useState<CardType>("epos");
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportHistory[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // インポート履歴を取得
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/import");
        if (res.ok) {
          const json = await res.json();
          setHistory(json.data);
        }
      } catch {
        // 履歴取得失敗は無視
      }
    })();
  }, [result]); // インポート成功後に再取得

  // ドラッグ&ドロップ処理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith(".csv")) {
      setFile(dropped);
      setResult(null);
      setErrorMsg(null);
    }
  }, []);

  /** CSVインポートを実行する */
  async function handleImport() {
    if (!file || !accountId) {
      setErrorMsg("口座を選択してCSVファイルを選んでください");
      return;
    }
    setStatus("loading");
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("account_id", accountId);
    formData.append("card_type", cardType);

    try {
      const res = await fetch("/api/v1/import", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error?.message ?? "インポートに失敗しました");
      }

      setResult(json.data);
      setStatus("success");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "不明なエラー");
      setStatus("error");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold text-gray-900">CSVインポート</h2>

      {/* 設定パネル */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        {/* ① カード種別選択 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            カード会社
          </label>
          <div className="flex gap-3">
            {(["epos", "saison"] as CardType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setCardType(type)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  cardType === type
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {type === "epos" ? "エポスカード" : "セゾンカード"}
              </button>
            ))}
          </div>
        </div>

        {/* ② 口座選択 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            インポート先口座
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">口座を選択してください</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>

        {/* ③ ファイルドロップエリア */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            CSVファイル
          </label>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragging
                ? "border-blue-400 bg-blue-50"
                : file
                ? "border-green-400 bg-green-50"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setResult(null);
                  setErrorMsg(null);
                }
              }}
            />
            {file ? (
              <div>
                <p className="text-sm font-medium text-green-700">{file.name}</p>
                <p className="mt-1 text-xs text-green-600">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500">
                  CSVファイルをドラッグ&ドロップ
                </p>
                <p className="mt-1 text-xs text-gray-400">または クリックして選択</p>
              </div>
            )}
          </div>
        </div>

        {/* エラー表示 */}
        {errorMsg && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* インポートボタン */}
        <button
          type="button"
          onClick={handleImport}
          disabled={!file || !accountId || status === "loading"}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {status === "loading" ? "インポート中..." : "インポート実行"}
        </button>
      </div>

      {/* 成功結果 */}
      {status === "success" && result && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6">
          <h3 className="text-sm font-semibold text-green-800 mb-3">
            ✓ インポート完了
          </h3>
          <div className="flex gap-6 text-sm text-green-700 mb-4">
            <span>取り込み: <strong>{result.imported_count} 件</strong></span>
            <span>スキップ: <strong>{result.skipped_count} 件</strong></span>
          </div>
          {result.preview.length > 0 && (
            <div>
              <p className="text-xs font-medium text-green-700 mb-2">
                先頭 {result.preview.length} 件のプレビュー:
              </p>
              <ul className="space-y-1">
                {result.preview.map((row, i) => (
                  <li
                    key={i}
                    className="flex justify-between text-xs text-green-800 bg-white rounded px-3 py-1.5"
                  >
                    <span>{row.transaction_date}</span>
                    <span className="flex-1 px-3 truncate">{row.note}</span>
                    <span className="font-medium">
                      ¥{row.amount.toLocaleString("ja-JP")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* インポート履歴 */}
      {history.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">
            インポート履歴
          </h3>
          <ul className="divide-y divide-gray-100">
            {history.slice(0, 10).map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-gray-900">{h.filename}</p>
                  <p className="text-xs text-gray-500">
                    {h.account?.name} ·{" "}
                    {new Date(h.imported_at).toLocaleDateString("ja-JP")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{h.row_count} 件</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      h.status === "success"
                        ? "bg-green-100 text-green-700"
                        : h.status === "error"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {h.status === "success"
                      ? "成功"
                      : h.status === "error"
                      ? "エラー"
                      : "処理中"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
