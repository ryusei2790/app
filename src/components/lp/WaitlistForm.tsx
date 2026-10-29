/**
 * @file components/lp/WaitlistForm.tsx
 * @description メールだけの事前登録フォーム（mywork#878 Q1=A）。確認メールは送らない。
 */

"use client";

import { useState } from "react";
import Link from "next/link";

export function WaitlistForm({ id }: { id?: string }) {
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setState("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, agree }),
      });
      if (res.ok) {
        setState("done");
        return;
      }
      const j = await res.json().catch(() => null);
      setErr(j?.error?.message ?? "送れませんでした。時間をおいてもう一度お試しください");
    } catch {
      setErr("送れませんでした。通信を確かめてもう一度お試しください");
    }
    setState("idle");
  }

  if (state === "done") {
    return (
      <div id={id} className="rounded-xl bg-green-50 p-5 text-center" role="status">
        <p className="text-base font-bold text-green-800">受け付けました</p>
        <p className="mt-1 text-sm text-green-700">公開したら、このアドレスにお知らせします。</p>
      </div>
    );
  }

  return (
    <form id={id} onSubmit={submit} className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
      <label className="block text-sm font-medium text-gray-800">
        メールアドレス
        <input
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 text-base"
          placeholder="you@example.com"
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4" />
        <span>
          <Link href="/about/terms" className="text-blue-600 underline">利用規約</Link>と
          <Link href="/about/privacy" className="text-blue-600 underline">プライバシー</Link>に同意する
        </span>
      </label>
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      <button
        type="submit"
        disabled={!agree || state === "sending"}
        className="w-full rounded-lg bg-blue-600 py-3 text-base font-bold text-white disabled:bg-gray-300"
      >
        {state === "sending" ? "送っています…" : "公開のお知らせを受け取る（無料）"}
      </button>
      <p className="text-xs text-gray-500">送るのはお知らせだけです。いつでも削除を頼めます。</p>
    </form>
  );
}
