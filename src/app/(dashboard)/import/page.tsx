/**
 * @file app/(dashboard)/import/page.tsx
 * @description CSVインポート画面（Server Component）。
 * 社長かどうかだけをサーバーで判定して渡す（取り込み後に「予算台帳で見る」を出すため）。
 */

import { CsvImportView } from "@/components/import/CsvImportView";
import { getAuthUser } from "@/lib/api-helpers";
import { isOwner } from "@/lib/features";

export default async function ImportPage() {
  const user = await getAuthUser();
  return <CsvImportView isOwner={isOwner(user)} />;
}
