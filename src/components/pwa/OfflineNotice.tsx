/**
 * @file components/pwa/OfflineNotice.tsx
 * @description 開いている画面でネットが切れたら「接続が必要です」の帯を出す（テスト一覧 W2）。
 * オフラインの間の保存は失敗として各フォームにも出る（後で送る仕組みは持たない）。
 */

"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
      接続が必要です。オフラインの間は記録できません。
    </div>
  );
}
