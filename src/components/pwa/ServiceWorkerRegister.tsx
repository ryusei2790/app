/**
 * @file components/pwa/ServiceWorkerRegister.tsx
 * @description public/sw.js を登録する（テスト一覧 W2）。表示は無い。
 * sw.js はキャッシュを持たないので、開発中に登録しても古い画面が残る心配はない。
 */

"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // 登録できなくてもアプリは普通に使える（ホーム画面に置けないだけ）
    });
  }, []);
  return null;
}
