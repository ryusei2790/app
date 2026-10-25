/**
 * @file app/not-found.tsx
 * @description 無い URL を開いたときの画面（mywork#764 ③）。英語の既定の 404 の代わりに日本語でホームへ戻す。
 */

import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { NOT_FOUND } from "@/lib/errors/screen";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center bg-gray-50">
      <ErrorScreen {...NOT_FOUND} />
    </main>
  );
}
