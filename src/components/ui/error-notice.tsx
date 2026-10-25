/**
 * @file components/ui/error-notice.tsx
 * @description 読み込み失敗の表示と「もう一度」ボタン（mywork#764 ③）。
 * 各画面の赤い帯をこれにそろえ、失敗したらその場でやり直せるようにする。
 */

"use client";

import { Button } from "@/components/ui/button";

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          もう一度
        </Button>
      )}
    </div>
  );
}
