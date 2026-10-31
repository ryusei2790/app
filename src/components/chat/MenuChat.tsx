/**
 * @file components/chat/MenuChat.tsx
 * @description メニューのチャット（mywork#573）。「ダッシュボードある？」と聞くと AI が機能を探し、マイメニューに足す。
 * 会話はこの画面のメモリだけに持つ（保存しない）。変更があったら結果カードと「元に戻す」を出し、メニューを読み直す。
 */

"use client";

import { useState } from "react";
import { UpgradeButton } from "@/components/billing/UpgradeButton";
import { useRouter } from "next/navigation";
import type { LayoutItem } from "@/lib/menu/layout";

interface Msg {
  role: "user" | "assistant";
  content: string;
  changes?: { message: string }[];
  previous?: LayoutItem[] | null;
}

const EXAMPLES = ["どんな機能がある？", "ダッシュボードを出して", "定期の支出を1番上にして", "CSVのアイコンを🧾にして"];

export function MenuChat() {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);

  async function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    const next: Msg[] = [...messages, { role: "user", content: t }];
    setMessages(next);
    setInput("");
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // AI に渡すのは文字だけ（結果カードは渡さない）
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice(json.error?.message ?? "送れませんでした");
        setLimitHit(json.error?.details?.canUpgrade === true);
        setMessages(messages); // 失敗した発言は取り下げて、入力欄に戻す
        setInput(t);
        return;
      }
      const d = json.data;
      setMessages([...next, { role: "assistant", content: d.reply, changes: d.changes, previous: d.previous }]);
      if (d.changes.length > 0) router.refresh();
    } catch {
      setNotice("通信できませんでした。電波のよいところでもう一度送ってください。");
      setMessages(messages);
      setInput(t);
    } finally {
      setSending(false);
    }
  }

  async function undo(index: number, previous: LayoutItem[]) {
    const res = await fetch("/api/v1/menu", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layout: previous }),
    });
    if (!res.ok) {
      setNotice("元に戻せませんでした");
      return;
    }
    setMessages((ms) => ms.map((m, i) => (i === index ? { ...m, previous: null, changes: [{ message: "元に戻しました" }] } : m)));
    router.refresh();
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4">
      <h1 className="text-lg font-bold text-gray-900">💬 チャット</h1>
      <p className="mt-1 text-xs text-gray-500">
        欲しい機能を聞くと、メニューの「マイメニュー」に追加します。置く順番・アイコン・名前も変えられます。
      </p>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => send(ex)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === "user" ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-800"
              }`}
            >
              {m.content}
              {m.changes && m.changes.length > 0 && (
                <div className="mt-2 rounded-lg bg-green-50 px-2 py-1.5 text-xs text-green-800" data-testid="chat-change">
                  {m.changes.map((c, j) => (
                    <p key={j}>✅ {c.message}</p>
                  ))}
                  {m.previous && (
                    <button type="button" onClick={() => undo(i, m.previous!)} className="mt-1 underline">
                      元に戻す
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && <p className="text-xs text-gray-400">考えています…</p>}
      </div>

      {notice && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}
      {limitHit && <div className="mt-2"><UpgradeButton /></div>}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="例: ダッシュボードある？"
          aria-label="メッセージ"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          送る
        </button>
      </form>
    </div>
  );
}
