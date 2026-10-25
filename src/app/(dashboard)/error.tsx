/**
 * @file app/(dashboard)/error.tsx
 * @description ログイン後の画面で起きた想定外のエラーの受け皿（mywork#764 ③）。layout の中に出るのでメニューは残り、別の画面へ移れる。
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
