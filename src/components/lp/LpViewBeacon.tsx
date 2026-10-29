/**
 * @file components/lp/LpViewBeacon.tsx
 * @description 着地ページを開いたことを1回だけ /api/lp/view に送る（mywork#878）。
 * UTM はアドレスのクエリから取り、cookie への保存はサーバー側で行う。
 */

"use client";

import { useEffect } from "react";
import { UTM_KEYS } from "@/lib/lp/utm";

export function LpViewBeacon() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const body: Record<string, string> = { referrer: document.referrer };
    for (const k of UTM_KEYS) {
      const v = q.get(k);
      if (v) body[k] = v;
    }
    fetch("/api/lp/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  }, []);
  return null;
}
