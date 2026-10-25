/**
 * @file components/settings/DataPanel.tsx
 * @description 設定の「データと書き出し」タブ（mywork#425 第2弾、設計書 4-6・4-11、テスト W10）。
 *
 *   1. 書き出し … 家計簿アプリ形式 CSV／完全形式（バックアップ）を端末に保存。前回のバックアップの日付を出し、月1回を促す。
 *      Google スプレッドシートへの書き出し（SheetExportButton、mywork#591）もここ
 *   2. 取り込みの取り消し … 取り込み履歴から「取り消す」（ImportHistoryList）
 *   3. 復元 … 完全形式のファイルを選ぶ → 件数を確かめる → 空の帳簿に入れる
 *   4. 全削除 … ①バックアップを保存（保存できるまで次へ進めない）→ ②確認語「削除」→ ③全部削除する
 *
 * 前回のバックアップの日付は、この端末の localStorage にだけ置く（端末ごとの目安。読めない環境でも画面は動く）。
 * サーバーに残すのは何も無い（書き出しはブラウザに返すだけ）。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { ImportHistoryList } from "@/components/import/ImportHistoryList";
import { downloadFromApi } from "./download";
import { SheetExportButton } from "./SheetExportButton";
import { errorMessage } from "@/lib/errors/api-error";

const DELETE_WORD = "削除";
const LAST_BACKUP_KEY = "kakebo.lastFullBackupAt";
/** これより前なら「そろそろ保存」を出す */
const REMIND_DAYS = 30;
const MAX_RESTORE_BYTES = 4 * 1024 * 1024;

/** 表の名前（完全形式の counts のキー → 画面の言葉） */
const TABLE_LABELS: Record<string, string> = {
  transactions: "取引",
  fixed_costs: "定期",
  accounts: "口座",
  categories: "自分のカテゴリー",
  csv_imports: "取り込み履歴",
  receipts: "レシート",
  budget_frames: "費目",
  budget_rules: "対応表",
};
const countsText = (counts: Record<string, number>) =>
  Object.entries(TABLE_LABELS)
    .filter(([key]) => (counts[key] ?? 0) > 0 || key === "transactions")
    .map(([key, label]) => `${label} ${counts[key] ?? 0}件`)
    .join("・");

function readLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}
function writeLastBackup(at: string) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, at);
  } catch {
    // 保存できない環境（プライベートモードなど）でも書き出し自体は済んでいる
  }
}

type Msg = { kind: "ok" | "error"; text: string } | null;
const msgClass = (m: NonNullable<Msg>) =>
  `rounded-lg p-3 text-sm ${m.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`;

export function DataPanel() {
  const [reloadKey, setReloadKey] = useState(0);
  // 前回のバックアップの日時と、それから何日たったか（今の時刻は描画中に読まないので、覚えるときに計算する）
  const [lastBackup, setLastBackupState] = useState<{ at: string; days: number } | null>(null);
  const setLastBackup = (at: string) => setLastBackupState({ at, days: Math.floor((Date.now() - Date.parse(at)) / 86_400_000) });
  const [exporting, setExporting] = useState<"csv" | "full" | null>(null);
  const [exportMsg, setExportMsg] = useState<Msg>(null);

  // 前回のバックアップ（この端末）。描画中に localStorage を読まない（サーバーで描くときに無いので）
  useEffect(() => {
    const at = readLastBackup();
    if (at) queueMicrotask(() => setLastBackup(at));
  }, []);

  /** 完全形式を保存し、保存できたら日付を覚える。全削除の前の保存と同じ処理 */
  async function saveFullBackup(): Promise<string | null> {
    const r = await downloadFromApi("/api/v1/export?format=full-json", "kakebo-full.json");
    if (!r.ok) {
      setExportMsg({ kind: "error", text: r.message });
      return null;
    }
    const at = new Date().toISOString();
    writeLastBackup(at);
    setLastBackup(at);
    let counts = "";
    try {
      counts = countsText(JSON.parse(r.text).counts ?? {});
    } catch {
      // 件数が読めなくても保存はできている
    }
    setExportMsg({ kind: "ok", text: `${r.filename} を保存しました（${counts}）` });
    return r.filename;
  }

  async function exportCsv() {
    setExporting("csv");
    setExportMsg(null);
    const r = await downloadFromApi("/api/v1/export?format=kakebo-csv", "kakebo.csv");
    setExportMsg(r.ok ? { kind: "ok", text: `${r.filename} を保存しました` } : { kind: "error", text: r.message });
    setExporting(null);
  }

  async function exportFull() {
    setExporting("full");
    setExportMsg(null);
    await saveFullBackup();
    setExporting(null);
  }

  const daysSince = lastBackup?.days ?? null;

  // ─── 復元 ─────────────────────────────────────
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const [restoreCounts, setRestoreCounts] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<Msg>(null);
  const [restoring, setRestoring] = useState(false);

  async function chooseRestoreFile(file: File | undefined) {
    setRestoreMsg(null);
    setRestoreText(null);
    setRestoreCounts(null);
    if (!file) return;
    if (file.size > MAX_RESTORE_BYTES) {
      setRestoreMsg({ kind: "error", text: "ファイルは 4MB までです" });
      return;
    }
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      if (json?.format !== "kakebo-full") throw new Error();
      setRestoreText(text);
      setRestoreCounts(
        `${countsText(json.counts ?? {})}（${json.exported_at ? new Date(json.exported_at).toLocaleString("ja-JP") : "日時不明"} に保存）`
      );
    } catch {
      setRestoreMsg({ kind: "error", text: "完全形式（kakebo-full_….json）のファイルを選んでください" });
    }
  }

  async function restore() {
    if (!restoreText) return;
    setRestoring(true);
    setRestoreMsg(null);
    try {
      const res = await fetch("/api/v1/restore", { method: "POST", headers: { "content-type": "application/json" }, body: restoreText });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "復元に失敗しました");
      setRestoreMsg({ kind: "ok", text: `復元しました（${countsText(json.data.restored)}）` });
      setRestoreText(null);
      setRestoreCounts(null);
      setReloadKey((n) => n + 1);
    } catch (e) {
      setRestoreMsg({ kind: "error", text: errorMessage(e, "復元に失敗しました") });
    } finally {
      setRestoring(false);
    }
  }

  // ─── 全削除 ───────────────────────────────────
  const [backupFile, setBackupFile] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<Msg>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // ①の保存が済んだら②の欄へ移る（スマホで次に何をするか迷わないように）
  useEffect(() => {
    if (backupFile) confirmRef.current?.focus();
  }, [backupFile]);

  async function backupBeforeDelete() {
    setBackingUp(true);
    setDeleteMsg(null);
    const filename = await saveFullBackup();
    if (filename) setBackupFile(filename);
    else setDeleteMsg({ kind: "error", text: "バックアップを保存できなかったので、削除には進めません" });
    setBackingUp(false);
  }

  async function deleteAll() {
    if (!backupFile || confirmWord !== DELETE_WORD) return;
    setDeleting(true);
    setDeleteMsg(null);
    try {
      const res = await fetch("/api/v1/account/delete-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: confirmWord }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "削除に失敗しました");
      setDeleteMsg({ kind: "ok", text: `削除しました（${countsText(json.data.deleted)}）。戻すときは ${backupFile} を「復元」で選びます` });
      setBackupFile(null);
      setConfirmWord("");
      setReloadKey((n) => n + 1);
    } catch (e) {
      setDeleteMsg({ kind: "error", text: errorMessage(e, "削除に失敗しました") });
    } finally {
      setDeleting(false);
    }
  }

  const canDelete = backupFile !== null && confirmWord === DELETE_WORD && !deleting;

  return (
    <div className="space-y-5">
      {/* 1. 書き出し */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">書き出し</h3>
        <p className="text-xs text-gray-500">
          無料のプランでは自動のバックアップを当てにできません。月に1回は「完全形式」を保存しておくと、消えても戻せます。
        </p>
        <p
          data-testid="last-backup"
          className={`rounded-lg px-3 py-2 text-xs ${daysSince === null || daysSince >= REMIND_DAYS ? "bg-amber-50 text-amber-900" : "bg-gray-50 text-gray-600"}`}
        >
          {lastBackup === null
            ? "この端末ではまだバックアップを保存していません"
            : `前回のバックアップ: ${new Date(lastBackup.at).toLocaleDateString("ja-JP")}（この端末）${daysSince !== null && daysSince >= REMIND_DAYS ? "。そろそろ保存しましょう" : ""}`}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={exportFull}
            disabled={exporting !== null}
            className="rounded-lg bg-blue-600 px-4 py-3 text-left text-sm font-medium text-white disabled:opacity-50"
          >
            {exporting === "full" ? "保存中…" : "完全形式（バックアップ）"}
            <span className="block text-xs font-normal text-blue-100">復元に使う JSON。全部の表が入ります</span>
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting !== null}
            className="rounded-lg border border-gray-300 px-4 py-3 text-left text-sm font-medium text-gray-800 disabled:opacity-50"
          >
            {exporting === "csv" ? "保存中…" : "CSV（家計簿アプリ形式）"}
            <span className="block text-xs font-normal text-gray-500">他のアプリ・表計算用。この家計簿に入れ直す用ではありません</span>
          </button>
        </div>
        {exportMsg && <p role="status" className={msgClass(exportMsg)}>{exportMsg.text}</p>}
        <SheetExportButton />
      </section>

      {/* 2. 取り込みの取り消し */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">取り込みの取り消し</h3>
        <p className="text-xs text-gray-500">間違えて入れた CSV を、その取り込みの分だけ消します。定期・カテゴリーは残ります。</p>
        {/* key で作り直す: 復元・全削除のあとに、前の「取り消しました」の表示を残さない */}
        <ImportHistoryList key={reloadKey} />
      </section>

      {/* 3. 復元 */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">復元</h3>
        <p className="text-xs text-gray-500">
          完全形式のファイルを、<strong>空の帳簿</strong>に戻します。データが残っているときは、先に下の「全削除」で空にしてください。
        </p>
        <label className="block text-xs font-medium text-gray-700">
          完全形式のファイルを選ぶ
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => chooseRestoreFile(e.target.files?.[0])}
            className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm"
          />
        </label>
        {restoreCounts && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
            <p data-testid="restore-preview" className="text-sm text-blue-900">{restoreCounts}</p>
            <button
              type="button"
              onClick={restore}
              disabled={restoring}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {restoring ? "復元中…" : "復元する"}
            </button>
          </div>
        )}
        {restoreMsg && <p data-testid="restore-result" role="status" className={msgClass(restoreMsg)}>{restoreMsg.text}</p>}
      </section>

      {/* 4. 全削除 */}
      <section className="rounded-xl border border-red-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-red-700">全削除</h3>
        <p className="text-xs text-gray-600">
          取引・定期・口座・自分のカテゴリー・取り込み履歴・レシート・費目を<strong>全部</strong>消します。
          <strong>元に戻せません。</strong>ログインはそのままできます。消す前に必ずバックアップを保存します。
        </p>

        <ol className="space-y-3 text-sm">
          <li>
            <p className="mb-1 text-xs font-medium text-gray-700">① バックアップ（完全形式）を保存</p>
            {backupFile ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">保存しました: {backupFile}</p>
            ) : (
              <button
                type="button"
                onClick={backupBeforeDelete}
                disabled={backingUp}
                className="w-full rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-800 disabled:opacity-50"
              >
                {backingUp ? "保存中…" : "バックアップを保存して次へ"}
              </button>
            )}
          </li>
          <li>
            <label className="block text-xs font-medium text-gray-700">
              ② 確認のため「{DELETE_WORD}」と入力
              <input
                type="text"
                ref={confirmRef}
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                disabled={!backupFile}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
              />
            </label>
          </li>
          <li>
            <button
              type="button"
              onClick={deleteAll}
              disabled={!canDelete}
              className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting ? "削除中…" : "全部削除する"}
            </button>
          </li>
        </ol>
        {deleteMsg && <p data-testid="delete-all-result" role="status" className={msgClass(deleteMsg)}>{deleteMsg.text}</p>}
      </section>
    </div>
  );
}
