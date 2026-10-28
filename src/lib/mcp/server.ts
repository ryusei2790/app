/**
 * @file lib/mcp/server.ts
 * @description MCP サーバー（道具の一覧と呼び出し）を組み立てる（mywork#882）。
 *
 * /api/mcp は「状態なし」（リクエストごとにサーバーを作って捨てる）。Vercel の関数は前のリクエストの
 * メモリを持ち越せないので、セッションを持たない形が合う（公式 SDK の stateless モード）。
 * 道具の中身は lib/mcp/tools.ts。ここは
 *   - 入力の型（zod。AI に見せる説明つき）
 *   - 読む／書くの印（annotations。AI 側が「書く道具は利用者に確認する」判断に使う）
 *   - 共通の流れ: withUserDb の中で 回数上限 → 実行 → 記録
 * だけを受け持つ。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { withUserDb, type UserDb } from "@/lib/db";
import { todayJst } from "@/lib/date/jst";
import type { McpPrincipal } from "./token";
import { checkMcpLimits, recordMcpCall } from "./rate-limit";
import {
  addExpense,
  categorySummary,
  listCategories,
  listFixedCosts,
  listRecent,
  MAX_MONTHS,
  MAX_NOTE,
  MAX_RECENT,
  monthlySummary,
  undoLastAdded,
  UNDO_WINDOW_HOURS,
  type ToolResult,
} from "./tools";

export const SERVER_INFO = { name: "kakebo", title: "カレンダー家計簿", version: "1.0.0" } as const;

const INSTRUCTIONS =
  "利用者本人の家計簿（日本円）です。金額は円の整数。日付は日本時間の YYYY-MM-DD、月は YYYY-MM。" +
  "書けるのは支出の追加（add_expense）と、AI が直前に足した1件の取り消し（undo_last_added）だけです。" +
  "編集・削除・収入の追加は家計簿の画面で行うよう利用者に案内してください。" +
  "カテゴリ名が分からないときは list_categories で確かめてから add_expense を呼んでください。";

/** 道具の結果を MCP の形にする（人が読む1文＋JSON。構造化した中身は structuredContent にも） */
function toCallResult(r: ToolResult<unknown>): CallToolResult {
  if (!r.ok) return { isError: true, content: [{ type: "text", text: r.message }] };
  return {
    content: [
      { type: "text", text: r.text },
      { type: "text", text: JSON.stringify(r.data) },
    ],
    structuredContent: r.data as Record<string, unknown>,
  };
}

/**
 * 共通の流れ。DB はすべてトークンで確かめた利用者として RLS を効かせて触る。
 * 上限に当たったら実行せずに理由を返す（記録もしない）。
 */
async function runTool(
  who: McpPrincipal,
  tool: string,
  isWrite: boolean,
  fn: (db: UserDb, today: string) => Promise<ToolResult<unknown>>
): Promise<CallToolResult> {
  const result = await withUserDb(who.userId, async (db) => {
    const limit = await checkMcpLimits(db, who.userId, isWrite);
    if (!limit.ok) return { ok: false as const, message: limit.message };
    const r = await fn(db, todayJst());
    await recordMcpCall(db, { userId: who.userId, clientId: who.clientId, tool, isWrite, ok: r.ok });
    return r;
  });
  return toCallResult(result);
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM で指定してください");

/** 確かめ終わった利用者1人分の MCP サーバーを作る */
export function createKakeboMcpServer(who: McpPrincipal): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool(
    "add_expense",
    {
      title: "支出を記録する",
      description:
        "支出を1件記録します。金額は円の整数。日付を省略すると今日（日本時間）。カテゴリ名はあいまいでも近いものに入りますが、" +
        "1つに決められないときは候補を返して記録しません。口座を省略すると最初に作った口座に入ります。",
      inputSchema: {
        amount: z.number().int().positive().max(9_999_999_999).describe("金額（円、1円以上の整数）"),
        category: z.string().max(50).optional().describe("カテゴリ名（例: 食費、日用品）。省略すると未分類"),
        date: z.string().max(10).optional().describe("日付 YYYY-MM-DD（日本時間）。省略すると今日"),
        note: z.string().max(MAX_NOTE).optional().describe("メモ（店名・品名など）"),
        account: z.string().max(50).optional().describe("口座名（例: 財布、楽天カード）。省略すると最初の口座"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => runTool(who, "add_expense", true, (db, today) => addExpense(db, who.userId, args, today))
  );

  server.registerTool(
    "undo_last_added",
    {
      title: "直前に記録した1件を取り消す",
      description:
        `AI（この接続や他の AI 接続）が直前に追加した支出1件を取り消します（${UNDO_WINDOW_HOURS}時間以内のものだけ）。` +
        "画面や CSV で入れた取引、それより前の記録は取り消せません。add_expense が返した id を渡すと、その1件が直前のものと一致するときだけ取り消します。",
      inputSchema: {
        id: z.string().uuid().optional().describe("取り消したい記録の id（add_expense の結果）。省略すると直前の1件"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (args) => runTool(who, "undo_last_added", true, (db) => undoLastAdded(db, who.userId, args.id))
  );

  server.registerTool(
    "monthly_summary",
    {
      title: "月の集計",
      description:
        "指定した月の収入・支出・差額・カテゴリ別・固定費と変動費・要確認の件数を返します（家計簿の画面と同じ数字）。" +
        "支出は購入−返金で、振替・借入・返済は含みません。今月は今日までの分です。",
      inputSchema: { month: monthSchema.optional().describe("月 YYYY-MM。省略すると今月") },
      annotations: READ_ONLY,
    },
    (args) => runTool(who, "monthly_summary", false, (db, today) => monthlySummary(db, who.userId, args.month, today))
  );

  server.registerTool(
    "category_summary",
    {
      title: "カテゴリ別の月ごとの推移",
      description: `期間（最大${MAX_MONTHS}か月）のカテゴリ別の支出を月ごとに返します。from を省略すると to の5か月前から。`,
      inputSchema: {
        from: monthSchema.optional().describe("始めの月 YYYY-MM"),
        to: monthSchema.optional().describe("終わりの月 YYYY-MM。省略すると今月"),
      },
      annotations: READ_ONLY,
    },
    (args) => runTool(who, "category_summary", false, (db, today) => categorySummary(db, who.userId, args.from, args.to, today))
  );

  server.registerTool(
    "list_fixed_costs",
    {
      title: "定期の収入・支出の一覧",
      description: "家賃・サブスク・給料などの定期の収入・支出を、次回日・金額・頻度・月あたりの額つきで返します。",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => runTool(who, "list_fixed_costs", false, (db, today) => listFixedCosts(db, who.userId, today))
  );

  server.registerTool(
    "list_categories",
    {
      title: "カテゴリ一覧",
      description: "支出・収入のカテゴリ名の一覧を返します。add_expense の category はこの中から選ぶと確実です。",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => runTool(who, "list_categories", false, (db) => listCategories(db, who.userId))
  );

  server.registerTool(
    "list_recent",
    {
      title: "取引の一覧",
      description: `取引を新しい順に返します。month を付けるとその月だけ（月の決算の確かめに使えます）。件数は最大${MAX_RECENT}件。`,
      inputSchema: {
        month: monthSchema.optional().describe("月 YYYY-MM。省略すると全期間の最近の分"),
        limit: z.number().int().min(1).max(MAX_RECENT).optional().describe("件数（既定20）"),
      },
      annotations: READ_ONLY,
    },
    (args) => runTool(who, "list_recent", false, (db, today) => listRecent(db, who.userId, args, today))
  );

  return server;
}
