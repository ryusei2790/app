/**
 * @file lib/mcp/rate-limit.ts
 * @description AI からの呼び出しの回数上限と記録（mywork#882、設計書 4節「1人あたり1分60回」）。
 *
 * Vercel の関数はリクエストごとに別のインスタンスで動きうるので、メモリでは数えられない。
 * 記録の表 mcp_calls（RLS: 本人の行の閲覧と追加だけ）を数える。
 * 道具の実行と同じ withUserDb のトランザクションの中で「数える → 実行 → 記録」するので、
 * 実行が例外で失敗したら記録も巻き戻る（失敗は数えない）。
 * 同時に大量に来た場合はわずかに上限を超えうるが、目的（暴走した AI の連打を止める）には十分。
 */

import type { UserDb } from "@/lib/db";

export const MCP_LIMITS = {
  /** 1分あたりの道具の呼び出し（読む・書く合計） */
  perMinute: 60,
  /** 1日（直近24時間）あたりの書き込み（支出の追加・取り消し） */
  writesPerDay: 200,
} as const;

export type LimitCheck = { ok: true } | { ok: false; message: string };

/** 上限に達していないか（記録はまだしない） */
export async function checkMcpLimits(db: UserDb, userId: string, isWrite: boolean, now: Date = new Date()): Promise<LimitCheck> {
  const lastMinute = await db.mcpCall.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - 60_000) } } });
  if (lastMinute >= MCP_LIMITS.perMinute) {
    return { ok: false, message: `呼び出しが多すぎます（1分に${MCP_LIMITS.perMinute}回まで）。少し待ってからもう一度試してください` };
  }
  if (isWrite) {
    const writes = await db.mcpCall.count({
      where: { userId, isWrite: true, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
    });
    if (writes >= MCP_LIMITS.writesPerDay) {
      return { ok: false, message: `今日の AI からの記録は上限（${MCP_LIMITS.writesPerDay}回）に達しました。家計簿の画面からは記録できます` };
    }
  }
  return { ok: true };
}

/** 1回分を記録する（中身は残さない: 道具の名前・どの AI か・書き込みか・成否だけ） */
export async function recordMcpCall(
  db: UserDb,
  call: { userId: string; clientId: string; tool: string; isWrite: boolean; ok: boolean }
): Promise<void> {
  await db.mcpCall.create({ data: call });
}
