/**
 * @file components/settings/AiConnectionPanel.tsx
 * @description 設定の「AI との接続」タブ（mywork#882）。
 *   1. つなぐ URL（/api/mcp）とコピー
 *   2. Claude・ChatGPT でのつなぎ方
 *   3. いま許可している AI の一覧と「解除」（Supabase Auth の listGrants / revokeGrant）
 * 解除すると、その AI のセッションとトークンが Supabase 側で消え、次の呼び出しから 401 になる
 * （/api/mcp は毎回 Supabase にトークンを問い合わせるので、期限を待たずに効く: lib/mcp/token.ts）。
 */

"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { MCP_PATH } from "@/lib/mcp/metadata";

interface Grant {
  clientId: string;
  name: string;
  uri: string;
  grantedAt: string;
}

/** URL はブラウザの origin から作る（サーバーで描くときは空。effect で setState しないための useSyncExternalStore） */
const noSubscribe = () => () => {};
const mcpUrl = () => `${window.location.origin}${MCP_PATH}`;

export function AiConnectionPanel() {
  const url = useSyncExternalStore(noSubscribe, mcpUrl, () => "");
  const [copied, setCopied] = useState(false);
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 解除の確認中の clientId（1回目の押下で確認、2回目で解除） */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 一覧を読んで画面に反映する（setState は await の後＝effect の中で同期的に呼ばない） */
  const load = useCallback(async () => {
    const { data, error: e } = await createClient().auth.oauth.listGrants();
    if (e) {
      setGrants([]);
      setError("接続中の AI の一覧を読めませんでした。時間をおいて開き直してください。");
      return;
    }
    setError(null);
    setGrants(
      (data ?? []).map((g) => ({ clientId: g.client.id, name: g.client.name || "名前のない AI アプリ", uri: g.client.uri, grantedAt: g.granted_at }))
    );
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境では、表示された URL を手で選んでもらう
    }
  }

  async function revoke(clientId: string) {
    if (confirming !== clientId) {
      setConfirming(clientId);
      return;
    }
    setBusy(true);
    const { error: e } = await createClient().auth.oauth.revokeGrant({ clientId });
    setBusy(false);
    setConfirming(null);
    if (e) {
      setError("解除できませんでした。もう一度試してください。");
      return;
    }
    await load();
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-sm text-gray-700">
          お使いの AI（Claude・ChatGPT など）にこの URL を1つ登録すると、AI との会話の中で「昼ごはん 850円つけて」「今月いくら使った？」ができます。
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            aria-label="AI に登録する URL"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800"
          />
          <button type="button" onClick={copy} className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {copied ? "コピーしました" : "コピー"}
          </button>
        </div>
      </section>

      <section className="space-y-2 text-sm text-gray-700">
        <h3 className="font-bold text-gray-900">つなぎ方</h3>
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="font-medium text-gray-900">Claude</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>設定 →「コネクタ」→「カスタムコネクタを追加」</li>
            <li>名前（例: 家計簿）と上の URL を入れて追加 →「連携/接続」</li>
            <li>家計簿のログイン画面が開くのでログインし、「許可する」</li>
          </ol>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="font-medium text-gray-900">ChatGPT</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>設定 →「アプリとコネクタ」→「詳細設定」で開発者モードを ON（有料プラン）</li>
            <li>「作成」→ 上の URL を入れ、認証は「OAuth」</li>
            <li>家計簿のログイン画面が開くのでログインし、「許可する」</li>
          </ol>
        </div>
        <p className="text-xs text-gray-500">
          AI ができるのは、読むこと・支出の記録・AI が直前に記録した1件の取り消しだけです。編集・削除はこの画面で行います。AI に聞いた内容に応じて、データがその AI のサービスへ送られます。
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-gray-900">許可している AI</h3>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {grants === null ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : grants.length === 0 ? (
          <p className="text-sm text-gray-500">まだありません。</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {grants.map((g) => (
              <li key={g.clientId} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{g.name}</p>
                  <p className="text-xs text-gray-500">{new Date(g.grantedAt).toLocaleDateString("ja-JP")} に許可</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revoke(g.clientId)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                    confirming === g.clientId ? "bg-red-600 text-white hover:bg-red-700" : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {confirming === g.clientId ? "本当に解除する" : "解除"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
