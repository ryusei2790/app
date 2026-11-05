/**
 * @file components/extensions/ExtensionsView.tsx
 * @description 拡張機能の ON/OFF と並べ替え（mywork#1150）。保存は PUT /api/v1/menu（チャットの「元に戻す」と同じ口・同じ検査）。
 * OFF はメニューから外すだけで、データ・自動処理は消えない。
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LayoutItem } from "@/lib/menu/layout";

export interface ExtensionFeature {
  id: string;
  label: string;
  icon: string;
  description: string;
}

export function ExtensionsView({ features }: { features: ExtensionFeature[] }) {
  const router = useRouter();
  const [layout, setLayout] = useState<LayoutItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/menu")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setLayout(j.data.layout))
      .catch(() => setError("読み込めませんでした。時間をおいて開き直してください"));
  }, []);

  async function save(next: LayoutItem[]) {
    setBusy(true);
    setError(null);
    const prev = layout;
    setLayout(next);
    try {
      const r = await fetch("/api/v1/menu", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: next }) });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch {
      setLayout(prev);
      setError("保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (!layout) return <div className="p-6 text-sm text-gray-500">{error ?? "読み込み中…"}</div>;

  const on = layout.map((i) => features.find((f) => f.id === i.featureId)).filter((f): f is ExtensionFeature => Boolean(f));
  const off = features.filter((f) => !layout.some((i) => i.featureId === f.id));

  const move = (idx: number, d: -1 | 1) => {
    const next = [...layout];
    const j = idx + d;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    save(next);
  };

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">🧩 拡張機能</h2>
        <p className="mt-1 text-xs text-gray-500">メニューに出す機能を選びます。外してもデータや自動の記録は消えません。</p>
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-500">メニューに出している（{on.length}）</h3>
        <ul className="space-y-2" data-testid="extensions-on">
          {on.map((f, idx) => {
            const item = layout.find((i) => i.featureId === f.id)!;
            return (
              <li key={f.id} className="flex items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
                <span className="text-xl">{item.icon ?? f.icon}</span>
                <span className="flex-1 text-sm font-medium text-gray-900">{item.label ?? f.label}</span>
                <button type="button" disabled={busy || idx === 0} onClick={() => move(idx, -1)} aria-label={`${f.label}を上へ`} className="rounded px-2 py-1 text-gray-500 disabled:opacity-30">▲</button>
                <button type="button" disabled={busy || idx === on.length - 1} onClick={() => move(idx, 1)} aria-label={`${f.label}を下へ`} className="rounded px-2 py-1 text-gray-500 disabled:opacity-30">▼</button>
                <button type="button" disabled={busy} onClick={() => save(layout.filter((i) => i.featureId !== f.id))} className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-600">外す</button>
              </li>
            );
          })}
          {on.length === 0 && <li className="text-xs text-gray-400">まだありません</li>}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-500">追加できる（{off.length}）</h3>
        <ul className="space-y-2" data-testid="extensions-off">
          {off.map((f) => (
            <li key={f.id} className="flex items-start gap-2 rounded-xl bg-white p-3 shadow-sm">
              <span className="text-xl">{f.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{f.label}</p>
                <p className="text-xs text-gray-500">{f.description}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => save([...layout, { featureId: f.id, icon: null, label: null }])} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white">追加</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
