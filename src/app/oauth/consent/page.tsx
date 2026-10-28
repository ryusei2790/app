/**
 * @file oauth/consent/page.tsx
 * @description AI 接続の同意画面（mywork#882）。Supabase Auth の OAuth サーバーが、利用者をここへ送ってくる
 * （/oauth/consent?authorization_id=…。場所は Supabase の設定 authorization_url_path）。
 *
 * 1. 未ログインならログイン画面へ（戻り先にこの画面を付ける。lib/safe-next.ts で中のパスだけ許す）
 * 2. Supabase から「どの AI が・どこへ戻るか」を読む。前に許可済みならそのまま AI へ戻す
 * 3. 何ができるようになるか・データが AI のサービスへ送られることを見せ、「許可する」「許可しない」を選ばせる
 * AI の名前は AI 側が自分で名乗ったもの（誰でも登録できる）なので、戻り先のドメインも必ず見せる。
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { approveAction, denyAction } from "./actions";
import { isAuthorizationId } from "./authorization-id";

export const dynamic = "force-dynamic";

const CAN_DO = [
  "家計簿の取引・カテゴリ・定期の収入と支出・月の集計を読む",
  "支出を1件ずつ記録する",
  "AI が直前に記録した1件を取り消す（24時間以内）",
];
// 「できないこと」は DB の制限ポリシーと /api/mcp の道具の範囲で実際に止めているものだけを書く（mywork#882）
const CANNOT_DO = ["取引の編集・削除、CSV の取り込み、全削除", "収入の記録・定期の変更", "予算台帳など本人だけの機能"];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md space-y-5 rounded-xl bg-white p-6 shadow-sm">{children}</div>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <Shell>
      <h1 className="text-lg font-bold text-gray-900">AI との接続</h1>
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
        {message}
      </p>
      <Link href="/calendar" className="block text-center text-sm text-blue-600 hover:underline">
        家計簿へ戻る
      </Link>
    </Shell>
  );
}

/** 戻り先 URL のホスト名（表示用）。読めなければそのまま */
function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.error === "expired") return <ErrorView message="接続の手続きの期限が切れたか、すでに終わっています。AI のアプリからもう一度つないでください。" />;
  const id = params.authorization_id;
  if (!isAuthorizationId(id)) return <ErrorView message="接続の情報が足りません。AI のアプリからもう一度つないでください。" />;

  // 1. ログインの確認
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  // 2. 申請の中身
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <ErrorView message="接続の手続きの期限が切れたか、見つかりません。AI のアプリからもう一度つないでください。" />;
  if (!("authorization_id" in data)) redirect(data.redirect_url); // 許可済み

  const clientName = data.client.name || "名前のない AI アプリ";
  const host = hostOf(data.redirect_uri);

  // 3. 同意
  return (
    <Shell>
      <div>
        <p className="text-xs text-gray-500">カレンダー家計簿</p>
        <h1 className="mt-1 text-lg font-bold text-gray-900">「{clientName}」に家計簿の利用を許可しますか？</h1>
      </div>

      <dl className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
        <div className="flex gap-2">
          <dt className="shrink-0 text-gray-500">接続先</dt>
          <dd className="break-all font-medium text-gray-900">{host}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-gray-500">あなた</dt>
          <dd className="break-all text-gray-900">{data.user.email}</dd>
        </div>
      </dl>
      <p className="text-xs text-gray-600">接続先が、あなたが使っている AI のサービス（例: claude.ai、chatgpt.com）と違うときは許可しないでください。</p>

      <section>
        <h2 className="text-sm font-bold text-gray-900">許可するとできること</h2>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
          {CAN_DO.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <h2 className="mt-3 text-sm font-bold text-gray-900">できないこと</h2>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
          {CANNOT_DO.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        許可すると、AI に聞いた内容に応じて家計簿のデータ（金額・メモ・カテゴリ）が接続先の AI のサービスへ送られます。
        接続はいつでも 設定 →「AI との接続」から解除できます。
      </p>

      <div className="flex gap-3">
        <form action={denyAction} className="flex-1">
          <input type="hidden" name="authorization_id" value={data.authorization_id} />
          <button type="submit" className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            許可しない
          </button>
        </form>
        <form action={approveAction} className="flex-1">
          <input type="hidden" name="authorization_id" value={data.authorization_id} />
          <button type="submit" className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
            許可する
          </button>
        </form>
      </div>
    </Shell>
  );
}
