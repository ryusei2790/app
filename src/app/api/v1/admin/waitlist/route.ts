/**
 * @file api/v1/admin/waitlist/route.ts
 * @description 事前登録の CSV（mywork#878）。メールを含むので社長だけ（requireOwner）。
 * 列: 登録日時（JST）・メール・utm_source・utm_medium・utm_campaign・utm_content
 */

import { requireOwner } from "@/lib/api-helpers";
import { getWaitlistReport } from "@/lib/admin-db";
import { csvCell } from "@/lib/lp/utm";

/** GET /api/v1/admin/waitlist → text/csv */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- route handler の形をそろえるため受け取る
export async function GET(_request: Request) {
  const { response } = await requireOwner();
  if (response) return response;
  const { signups } = await getWaitlistReport();
  const jst = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const lines = [
    "created_at_jst,email,utm_source,utm_medium,utm_campaign,utm_content",
    ...signups.map((s) =>
      [jst(s.createdAt), s.email, s.utmSource, s.utmMedium, s.utmCampaign, s.utmContent].map(csvCell).join(",")
    ),
  ];
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="waitlist.csv"',
      "cache-control": "no-store",
    },
  });
}
