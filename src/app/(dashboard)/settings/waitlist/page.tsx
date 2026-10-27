/**
 * @file app/(dashboard)/settings/waitlist/page.tsx
 * @description 事前登録の件数と、広告の案（utm_content）別の「開いた人・登録数・登録率」（mywork#878）。
 * メールを含むので社長（OWNER_USER_IDS）だけ。それ以外は 404。CSV は /api/v1/admin/waitlist。
 */

import { notFound } from "next/navigation";
import { getAuthUser } from "@/lib/api-helpers";
import { isOwner } from "@/lib/features";
import { getWaitlistReport } from "@/lib/admin-db";

export const dynamic = "force-dynamic";

export default async function WaitlistReportPage() {
  if (!isOwner(await getAuthUser())) notFound();
  const { signups, byContent } = await getWaitlistReport();
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-gray-900">事前登録</h1>
        <a href="/api/v1/admin/waitlist" className="text-sm text-blue-600 hover:underline">CSV をダウンロード</a>
      </div>
      <p className="text-sm text-gray-600">登録 <b className="text-lg text-gray-900">{signups.length}</b> 件</p>
      <table className="w-full text-sm" data-testid="waitlist-by-content">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">広告の案</th><th>開いた人</th><th>開いた回数</th><th>登録</th><th>登録率</th>
          </tr>
        </thead>
        <tbody>
          {byContent.map((r) => (
            <tr key={r.utmContent ?? "(none)"} className="border-b">
              <td className="py-2">{r.utmContent ?? "（UTM なし）"}</td>
              <td>{r.visitors}</td><td>{r.views}</td><td>{r.signups}</td><td>{pct(r.signups, r.visitors)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500">開いた人＝ブラウザの番号（30日）で数えた人数。ボットと30分以内の再読み込みは数えていません。</p>
    </div>
  );
}
