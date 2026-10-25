/**
 * @file app/global-error.tsx
 * @description 一番外側の layout まで壊れたときの最後の受け皿（mywork#764 ③）。
 * root layout の代わりに出るので html・body と globals.css を自分で持つ。
 */

"use client";

import "./globals.css";
import { useEffect } from "react";
import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { SCREEN_ERROR } from "@/lib/errors/screen";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="ja">
      <body className="flex min-h-screen items-center bg-gray-50">
        <title>エラー | 家計簿</title>
        <ErrorScreen {...SCREEN_ERROR} onRetry={() => unstable_retry()} digest={error.digest} />
      </body>
    </html>
  );
}
