/**
 * @file scripts/mcp/demo.ts
 * @description AI 接続（/api/mcp、mywork#882）を**ローカルだけ**で実際の AI（Claude Code など）から試すための準備。
 *   1. デモ用の利用者を作り、2026年10月の作り物の家計（本人の家計データは使わない）を入れる
 *   2. ローカル Supabase の OAuth サーバーで、その利用者として「許可」まで済ませて AI 用のトークンを取る
 *   3. Claude Code の --mcp-config に渡せる JSON を書き出す（トークンは1時間で切れる。git に入れない場所に書く）
 *   4. 突き合わせ用に、DB から直接数えた「答え」（件数・合計）を出す（AI の答えと比べる）
 *
 * 使い方（アプリを 127.0.0.1:3000 で起動しておく）:
 *   NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… SERVICE_ROLE_KEY=… DATABASE_URL=<ローカル> \
 *     npx tsx --tsconfig tsconfig.json scripts/mcp/demo.ts <書き出す mcp-config.json> [MCP の URL]
 * 何度流してもよい（毎回新しいデモ利用者を作る）。
 */

import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { obtainOAuthToken } from "../../tests/helpers/oauth";

const MONTH = "2026-10";

/** 作り物の10月（金額・メモは架空）。[日, 金額, カテゴリ, メモ, 種類] */
type Row = [number, number, string | null, string, ("normal" | "refund" | "transfer")?, ("income" | "expense")?];
const ROWS: Row[] = [
  [1, 432, "食費", "スーパー"], [1, 650, "外食", "ランチ"], [2, 220, "交通費", "バス"], [3, 1280, "日用品", "ドラッグストア"],
  [4, 980, "食費", "スーパー"], [5, 1500, "娯楽", "映画"], [6, 760, "外食", "ランチ"], [7, 2310, "食費", "まとめ買い"],
  [8, 440, "交通費", "電車"], [9, 3300, "衣服", "靴下とシャツ"], [10, 890, "外食", "カフェ"], [11, 1530, "食費", "スーパー"],
  [12, 640, "交通費", "電車"], [13, 4200, "医療", "歯医者"], [14, 720, "外食", "ランチ"], [15, 1980, "日用品", "洗剤"],
  [16, 1150, "食費", "スーパー"], [17, 2600, "娯楽", "本"], [18, 830, "外食", "ランチ"], [19, 1760, "食費", "スーパー"],
  [20, 300, "交通費", "バス"], [21, 1460, "食費", "スーパー"], [21, 1460, "食費", "スーパー"], // 二重登録の疑い（同じ日・同じ金額）
  [22, 990, "外食", "ランチ"], [23, 560, null, "よく分からない出費"], // 未分類
  [24, 2050, "食費", "まとめ買い"], [25, 1200, "衣服", "シャツの返品", "refund", "income"], // 返金（支出から引く）
  [26, 30000, null, "貯金口座へ", "transfer", "expense"], // 振替（支出に入れない）
  [27, 680, "外食", "ランチ"], [28, 1340, "食費", "スーパー"],
  [30, 3000, "医療", "歯医者の予約分"], // 今日より後＝予定
];

function assertLocal(url: string) {
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(`ローカル以外には繋ぎません: ${url}`);
  }
}

async function main() {
  const [outPath, mcpUrl = "http://127.0.0.1:3000/api/mcp"] = process.argv.slice(2);
  if (!outPath) throw new Error("書き出す mcp-config.json のパスを渡してください");
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SERVICE_ROLE_KEY!;
  const dbUrl = process.env.DATABASE_URL!;
  for (const u of [apiUrl, dbUrl, mcpUrl]) assertLocal(u);

  // 1. デモ利用者
  const np = { auth: { persistSession: false, autoRefreshToken: false } };
  const email = `demo-mcp-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(apiUrl, service, np);
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw error ?? new Error("デモ利用者を作れません");
  const userId = created.user.id;

  const pool = new Pool({ connectionString: dbUrl, max: 1 });
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
  const [wallet] = await q<{ id: string }>("INSERT INTO accounts (user_id, name, type) VALUES ($1, '財布', 'cash') RETURNING id", [userId]);
  const [card] = await q<{ id: string }>("INSERT INTO accounts (user_id, name, type) VALUES ($1, 'デモカード', 'credit_card') RETURNING id", [userId]);
  const [housing] = await q<{ id: string }>("INSERT INTO categories (user_id, name, type) VALUES ($1, '住居', 'expense') RETURNING id", [userId]);
  const cats = new Map((await q<{ id: string; name: string }>("SELECT id, name FROM categories WHERE user_id IS NULL")).map((c) => [c.name, c.id]));
  cats.set("住居", housing.id);

  // 定期（家賃・通信・サブスク・給与）と、その10月分の取引（定期実行が作るのと同じ source='auto'）
  const fixed: Array<[string, number, string, number, "income" | "expense", boolean]> = [
    ["家賃（デモ）", 65000, "住居", 27, "expense", false],
    ["スマホ（デモ）", 2980, "通信", 5, "expense", false],
    ["音楽サブスク（デモ）", 980, "娯楽", 23, "expense", true],
    ["給与（デモ）", 220000, "給与", 25, "income", false],
  ];
  for (const [name, amount, cat, day, type, sub] of fixed) {
    const [fc] = await q<{ id: string }>(
      `INSERT INTO fixed_costs (user_id, account_id, category_id, name, amount, type, billing_day, start_date, generated_through, is_subscription)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-09-01', $8, $9) RETURNING id`,
      [userId, type === "income" ? wallet.id : card.id, cats.get(cat), name, amount, type, day, `${MONTH}-28`, sub]
    );
    await q(
      `INSERT INTO transactions (user_id, account_id, category_id, fixed_cost_id, amount, type, transaction_date, note, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'auto')`,
      [userId, type === "income" ? wallet.id : card.id, cats.get(cat), fc.id, amount, type, `${MONTH}-${String(day).padStart(2, "0")}`, name]
    );
  }
  for (const [day, amount, cat, note, kind = "normal", type = "expense"] of ROWS) {
    await q(
      `INSERT INTO transactions (user_id, account_id, category_id, amount, type, kind, transaction_date, note, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')`,
      [userId, wallet.id, cat ? cats.get(cat) : null, amount, type, kind, `${MONTH}-${String(day).padStart(2, "0")}`, note]
    );
  }

  // 2. AI 用のトークン（同意画面の「許可する」と同じ API で許可）
  const user = createClient(apiUrl, anon, np);
  const { error: signInError } = await user.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const tokens = await obtainOAuthToken(apiUrl, user, "Claude Code（ローカル試験）");

  // 3. Claude Code の設定
  const config = { mcpServers: { kakebo: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${tokens.access_token}` } } } };
  await writeFile(outPath, JSON.stringify(config, null, 2), { mode: 0o600 });

  // 4. 突き合わせ用の答え（DB から直接。定義は lib/aggregate と同じ: 支出＝購入−返金、振替は除く、今日より後は予定）
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const [ans] = await q<Record<string, string>>(
    `SELECT count(*) AS all_rows,
            count(*) FILTER (WHERE transaction_date <= $2) AS rows_to_today,
            count(*) FILTER (WHERE transaction_date > $2) AS scheduled_rows,
            coalesce(sum(amount) FILTER (WHERE transaction_date <= $2 AND type='expense' AND kind='normal'), 0)
              - coalesce(sum(amount) FILTER (WHERE transaction_date <= $2 AND kind='refund'), 0) AS expense_total,
            coalesce(sum(amount) FILTER (WHERE transaction_date <= $2 AND type='income' AND kind='normal'), 0) AS income_total,
            count(*) FILTER (WHERE category_id IS NULL AND kind = 'normal') AS uncategorized
       FROM transactions WHERE user_id = $1 AND deleted_at IS NULL AND transaction_date BETWEEN '${MONTH}-01' AND '${MONTH}-31'`,
    [userId, today]
  );
  await pool.end();
  console.log(JSON.stringify({ email, userId, clientId: tokens.clientId, today, answer: ans }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
