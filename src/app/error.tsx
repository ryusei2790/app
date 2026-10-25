/**
 * @file app/error.tsx
 * @description 画面の表示中に起きた想定外のエラー（DB が落ちた等）の受け皿（mywork#764 ③）。
 * (dashboard) の中は (dashboard)/error.tsx がメニューを残したまま受ける。ここはそれ以外（ログイン・使い方など）。
 */

"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { SCREEN_ERROR } from "@/lib/errors/screen";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorScreen {...SCREEN_ERROR} onRetry={() => unstable_retry()} digest={error.digest} />;
}
