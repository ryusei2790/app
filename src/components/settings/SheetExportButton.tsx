/**
 * @file components/settings/SheetExportButton.tsx
 * @description 「スプシに書き出す」ボタン（mywork#591 案A1・範囲①）。設定の「データと書き出し」に置く。
 *
 * 流れ:
 *   1. 画面を開いたら Google Identity Services（GIS）のスクリプトを読んでおく
 *   2. ボタン → GIS のトークンクライアントで許可画面（権限は drive.file＝このアプリが作ったファイルだけ）
 *   3. 許可されたら /api/v1/export?format=sheet-json（本人の取引＋月次集計、RLS 経由）を取る
 *   4. Sheets API spreadsheets.create に送って新しいスプシ「家計簿_YYYY-MM-DD」を作り、開くリンクを出す
 *
 * なぜ許可を先にするか: ブラウザは「押した直後」の操作でしかポップアップを開かせない。データを取ってからだと
 * 許可画面がブロックされるので、押した瞬間に許可画面を出す。作ったスプシも自動では開かずリンクで出す（同じ理由）。
 *
 * アクセストークンはこの関数の中の変数にだけ置き、保存しない・サーバーに送らない。クライアント ID は公開値
 * （NEXT_PUBLIC_GOOGLE_CLIENT_ID）。未設定ならボタンを押せないようにして理由を出す。
 */

"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/errors/api-error";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** GIS の使う分だけの型（@types を足さずに済ませる） */
type TokenResponse = { access_token?: string; error?: string };
type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (c: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string }) => void;
      }) => TokenClient;
    };
  };
};
const gis = () => (window as unknown as { google?: Gis }).google;

/** GIS のスクリプトを1回だけ読む（同じ画面を何度開いても足さない） */
function loadGis(): Promise<void> {
  if (gis()?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("gis")));
    if (!existing) {
      s.src = GIS_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
  });
}

type Msg = { kind: "ok"; url: string; title: string } | { kind: "error"; text: string } | null;

export function SheetExportButton() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    loadGis()
      .then(() => setReady(true))
      .catch(() => setMsg({ kind: "error", text: "Google の部品を読めませんでした。電波の良いところで開き直してください" }));
  }, []);

  /** 許可されたあと: データを取ってスプシを作る */
  async function createSheet(token: string) {
    try {
      const res = await fetch("/api/v1/export?format=sheet-json", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "書き出しに失敗しました");
      const g = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(json.data),
      });
      const sheet = await g.json().catch(() => null);
      if (!g.ok || !sheet?.spreadsheetUrl) throw new Error("スプレッドシートを作れませんでした。もう一度押してください");
      setMsg({ kind: "ok", url: sheet.spreadsheetUrl, title: sheet.properties?.title ?? "スプレッドシート" });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e, "書き出しに失敗しました") });
    } finally {
      setBusy(false);
    }
  }

  function start() {
    const g = gis();
    if (!g) return;
    setBusy(true);
    setMsg(null);
    const client = g.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) {
          setBusy(false);
          setMsg({ kind: "error", text: "Google の許可が得られませんでした" });
          return;
        }
        void createSheet(r.access_token);
      },
      // 許可画面を閉じた・ポップアップが止められたとき
      error_callback: () => {
        setBusy(false);
        setMsg({ kind: "error", text: "Google の許可画面が閉じられました。もう一度押してください" });
      },
    });
    client.requestAccessToken();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={!CLIENT_ID || !ready || busy}
        className="w-full rounded-lg border border-emerald-600 px-4 py-3 text-left text-sm font-medium text-emerald-800 disabled:opacity-50"
      >
        {busy ? "書き出し中…" : "スプシに書き出す（Google）"}
        <span className="block text-xs font-normal text-gray-500">
          {CLIENT_ID ? "取引と月次集計の新しいスプレッドシートを、あなたの Google ドライブに作ります" : "準備中（Google の設定がまだです）"}
        </span>
      </button>
      {msg?.kind === "ok" && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {msg.title} を作りました。
          <a href={msg.url} target="_blank" rel="noopener noreferrer" className="ml-1 font-medium underline">
            開く
          </a>
        </p>
      )}
      {msg?.kind === "error" && (
        <p role="status" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {msg.text}
        </p>
      )}
    </div>
  );
}
