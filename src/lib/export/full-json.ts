/**
 * @file lib/export/full-json.ts
 * @description 完全形式 JSON（バックアップの本体）の書き出しと復元（mywork#425 第2弾、設計書 4-11、テスト X2・X3）。
 *
 * 中身: 本人の 口座・カテゴリー（自分の分）・定期（条件込み）・取り込み履歴・取引（種類・行の目印・作り方・消した行も込み）・
 *       レシート・費目・対応表。共通カテゴリー（user_id が NULL）は「id・名前・種別」だけを入れる
 *       （共通カテゴリーの id は DB ごとに違うので、復元のときに名前と種別で今の DB の id に付け直す）。
 *       「設定」の表は今は無い（何か増えたらここに足し、FULL_VERSION を上げる）。auth のユーザー・profiles・レシートの読み取り回数は入れない。
 *
 * 復元: 空の帳簿にだけ入れる。id・作った日時を保つので、復元後に書き出すと同じ内容になる（X3）。
 *   - 空でなければ not_empty（API は 409）。先に全削除してもらう（重複を防ぐ）
 *   - 予算台帳を開くと初期の費目が自動で作られる（lib/budget/store.ts の ensureBudgetDefaults）ので、
 *     費目・対応表だけは「空」の判定に数えず、バックアップに費目があれば置き換える
 *   - 参照先の無い行があれば invalid（422）、同じ id の行が既にあれば conflict（409）。
 *     withUserDb の1トランザクションの中で投げるので、途中まで入ることはない
 *
 * 中身（金額・メモ）はログにも、エラーの理由にも出さない（S11）。ここでは console を使わない。
 */

import { z } from "zod";
import type { UserDb } from "@/lib/db";
import { isUuid } from "@/lib/db";
import { dateOnlyToDb, dbToDateOnly } from "@/lib/date/jst";
import { parseDateOnly } from "@/lib/validation/transaction";
import { DEFINITIONS_VERSION, TRANSACTION_KINDS } from "@/lib/aggregate/definitions";

export const FULL_FORMAT = "kakebo-full";
/** 形を変えたら上げる。復元は同じ版だけ受け付ける（知らない版を半端に入れない） */
export const FULL_VERSION = 1;
/** 復元で受け付ける本文の大きさ。Vercel の関数は本文 4.5MB までなので、その手前で止める */
export const MAX_RESTORE_BYTES = 4 * 1024 * 1024;

// ─── 形（zod）。書き出しの型もここから作る ─────────────────────────

const uuid = z.string().refine(isUuid, "id の形が違います");
const date = z.string().refine((v) => parseDateOnly(v).ok, "日付の形が違います");
const instant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "日時の形が違います");
const yen = z.number().finite().min(0).max(9_999_999_999);
const flow = z.enum(["income", "expense"]);

const accountSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(200),
  type: z.enum(["cash", "credit_card", "bank"]),
  currency: z.string().min(1).max(10),
  created_at: instant,
});
const categorySchema = z.object({
  id: uuid,
  name: z.string().min(1).max(200),
  type: flow,
  color: z.string().max(50).nullable(),
  icon: z.string().max(100).nullable(),
  created_at: instant,
});
const commonCategorySchema = z.object({ id: uuid, name: z.string().min(1).max(200), type: flow });
const fixedCostSchema = z.object({
  id: uuid,
  account_id: uuid,
  category_id: uuid.nullable(),
  name: z.string().min(1).max(200),
  amount: yen,
  type: flow,
  cycle: z.enum(["weekly", "biweekly", "monthly", "yearly"]),
  billing_day: z.number().int().min(1).max(31).nullable(),
  billing_month: z.number().int().min(1).max(12).nullable(),
  start_date: date,
  end_date: date.nullable(),
  generated_through: date.nullable(),
  is_active: z.boolean(),
  match_note: z.string().max(50).nullable(),
  match_any_amount: z.boolean(),
  // 2026-10-20 追加。それより前の書き出しには無いので円とみなす
  currency: z.enum(["JPY", "USD"]).default("JPY"),
  // 2026-10-23 追加（サブスクの管理欄、mywork#742 ②）。それより前の書き出しには無いので空とみなす（版は上げない）
  is_subscription: z.boolean().default(false),
  manage_url: z.string().regex(/^https?:\/\//i).max(2000).nullable().default(null),
  cancel_url: z.string().regex(/^https?:\/\//i).max(2000).nullable().default(null),
  next_renewal_date: date.nullable().default(null),
  payment_card: z.string().max(50).nullable().default(null),
  memo: z.string().max(500).nullable().default(null),
  created_at: instant,
});
const csvImportSchema = z.object({
  id: uuid,
  account_id: uuid,
  filename: z.string().max(500),
  status: z.enum(["pending", "success", "error", "undone"]),
  row_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0),
  imported_at: instant,
});
const transactionSchema = z.object({
  id: uuid,
  account_id: uuid,
  category_id: uuid.nullable(),
  fixed_cost_id: uuid.nullable(),
  amount: yen,
  type: flow,
  kind: z.enum(TRANSACTION_KINDS),
  transaction_date: date,
  note: z.string().max(10_000).nullable(),
  source: z.enum(["manual", "csv", "auto", "api", "receipt"]),
  csv_import_id: uuid.nullable(),
  import_key: z.string().max(100).nullable(),
  deleted_at: instant.nullable(),
  created_at: instant,
  updated_at: instant,
});
const receiptSchema = z.object({
  id: uuid,
  transaction_id: uuid,
  merchant: z.string().min(1).max(200),
  purchased_at: date,
  total: yen,
  items: z.array(z.unknown()),
  model: z.string().max(200).nullable(),
  created_at: instant,
});
const budgetFrameSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(50),
  monthly_limit: z.number().int().min(0),
  target: z.number().int().min(0).nullable(),
  sort_order: z.number().int(),
  created_at: instant,
});
const budgetRuleSchema = z.object({
  id: uuid,
  category_id: uuid.nullable(),
  memo_keyword: z.string().min(1).max(50).nullable(),
  frame_id: uuid.nullable(),
  priority: z.number().int(),
  created_at: instant,
});

const dataSchema = z.object({
  accounts: z.array(accountSchema),
  categories: z.array(categorySchema),
  common_categories: z.array(commonCategorySchema),
  fixed_costs: z.array(fixedCostSchema),
  csv_imports: z.array(csvImportSchema),
  transactions: z.array(transactionSchema),
  receipts: z.array(receiptSchema),
  budget_frames: z.array(budgetFrameSchema),
  budget_rules: z.array(budgetRuleSchema),
});

const backupSchema = z.object({
  format: z.literal(FULL_FORMAT),
  version: z.literal(FULL_VERSION),
  exported_at: instant,
  definitions_version: z.string().max(50),
  // counts は書き出しの見出し（人が読む用）。復元では使わず、data から数え直す
  counts: z.record(z.string(), z.number()).optional(),
  data: dataSchema,
});

export type BackupData = z.infer<typeof dataSchema>;
export type FullBackup = z.infer<typeof backupSchema> & { counts: BackupCounts };
/** 表ごとの行数（common_categories は本人の行ではないので数えない） */
export type BackupCounts = Record<Exclude<keyof BackupData, "common_categories">, number>;

export function emptyBackupData(): BackupData {
  return {
    accounts: [], categories: [], common_categories: [], fixed_costs: [], csv_imports: [],
    transactions: [], receipts: [], budget_frames: [], budget_rules: [],
  };
}

export function countBackup(data: BackupData): BackupCounts {
  return {
    accounts: data.accounts.length,
    categories: data.categories.length,
    fixed_costs: data.fixed_costs.length,
    csv_imports: data.csv_imports.length,
    transactions: data.transactions.length,
    receipts: data.receipts.length,
    budget_frames: data.budget_frames.length,
    budget_rules: data.budget_rules.length,
  };
}

/**
 * 受け取った JSON を確かめる。理由には「どの表の何番目のどの項目か」だけを入れ、値（金額・メモ）は入れない。
 */
export function parseBackup(input: unknown): { ok: true; backup: FullBackup } | { ok: false; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "完全形式の JSON ではありません" };
  }
  const head = input as { format?: unknown; version?: unknown };
  if (head.format !== FULL_FORMAT) return { ok: false, reason: "完全形式（kakebo-full）のファイルではありません" };
  if (head.version !== FULL_VERSION) return { ok: false, reason: `この版（${FULL_VERSION}）の完全形式ではありません` };
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `ファイルの形が違います（${issue.path.join(".")}）` };
  }
  return { ok: true, backup: { ...parsed.data, counts: countBackup(parsed.data.data) } };
}

// ─── 書き出し ──────────────────────────────────────────────

const iso = (d: Date) => d.toISOString();
const dateOrNull = (d: Date | null) => (d ? dbToDateOnly(d) : null);
/** DB からは作った順に読む */
const ORDER = [{ createdAt: "asc" as const }, { id: "asc" as const }];

/**
 * 書き出す配列を「ミリ秒の日時 → id」で並べ直す。
 * なぜ: DB の日時はマイクロ秒まであるが JSON はミリ秒まで。同じミリ秒に作った行は、復元前（マイクロ秒の順）と
 * 復元後（ミリ秒が同じなので id の順）で並びが変わり、「復元後に書き出すと同じ内容」（X3）が崩れる。
 */
function stableSort<T extends { id: string }>(rows: T[], at: (r: T) => string): T[] {
  return rows.sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 本人の全表を読んで完全形式にする。withUserDb の中で呼ぶ（RLS が効く。userId でも絞る） */
export async function buildBackup(db: UserDb, userId: string, now: Date = new Date()): Promise<FullBackup> {
  const [accounts, categories, common, fixedCosts, imports, txs, receipts, frames, rules] = await Promise.all([
    db.account.findMany({ where: { userId }, orderBy: ORDER }),
    db.category.findMany({ where: { userId }, orderBy: ORDER }),
    db.category.findMany({ where: { userId: null }, select: { id: true, name: true, type: true }, orderBy: ORDER }),
    db.fixedCost.findMany({ where: { userId }, orderBy: ORDER }),
    db.csvImport.findMany({ where: { userId }, orderBy: [{ importedAt: "asc" }, { id: "asc" }] }),
    db.transaction.findMany({ where: { userId }, orderBy: ORDER }),
    db.receipt.findMany({ where: { userId }, orderBy: ORDER }),
    db.budgetFrame.findMany({ where: { userId }, orderBy: ORDER }),
    db.budgetRule.findMany({ where: { userId }, orderBy: ORDER }),
  ]);

  const data: BackupData = {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type as "cash", currency: a.currency, created_at: iso(a.createdAt) })),
    categories: categories.map((c) => ({
      id: c.id, name: c.name, type: c.type as "expense", color: c.color, icon: c.icon, created_at: iso(c.createdAt),
    })),
    common_categories: common.map((c) => ({ id: c.id, name: c.name, type: c.type as "expense" })),
    fixed_costs: fixedCosts.map((f) => ({
      id: f.id,
      account_id: f.accountId,
      category_id: f.categoryId,
      name: f.name,
      amount: Number(f.amount),
      type: f.type as "expense",
      cycle: f.cycle as "monthly",
      billing_day: f.billingDay,
      billing_month: f.billingMonth,
      start_date: dbToDateOnly(f.startDate),
      end_date: dateOrNull(f.endDate),
      generated_through: dateOrNull(f.generatedThrough),
      is_active: f.isActive,
      match_note: f.matchNote,
      match_any_amount: f.matchAnyAmount,
      currency: f.currency as "JPY" | "USD",
      is_subscription: f.isSubscription,
      manage_url: f.manageUrl,
      cancel_url: f.cancelUrl,
      next_renewal_date: dateOrNull(f.nextRenewalDate),
      payment_card: f.paymentCard,
      memo: f.memo,
      created_at: iso(f.createdAt),
    })),
    csv_imports: imports.map((i) => ({
      id: i.id,
      account_id: i.accountId,
      filename: i.filename,
      status: i.status as "success",
      row_count: i.rowCount,
      skipped_count: i.skippedCount,
      imported_at: iso(i.importedAt),
    })),
    transactions: txs.map((t) => ({
      id: t.id,
      account_id: t.accountId,
      category_id: t.categoryId,
      fixed_cost_id: t.fixedCostId,
      amount: Number(t.amount),
      type: t.type as "expense",
      kind: t.kind as "normal",
      transaction_date: dbToDateOnly(t.transactionDate),
      note: t.note,
      source: t.source as "manual",
      csv_import_id: t.csvImportId,
      import_key: t.importKey,
      deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
      created_at: iso(t.createdAt),
      updated_at: iso(t.updatedAt),
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      transaction_id: r.transactionId,
      merchant: r.merchant,
      purchased_at: dbToDateOnly(r.purchasedAt),
      total: Number(r.total),
      items: Array.isArray(r.items) ? (r.items as unknown[]) : [],
      model: r.model,
      created_at: iso(r.createdAt),
    })),
    budget_frames: frames.map((f) => ({
      id: f.id, name: f.name, monthly_limit: f.monthlyLimit, target: f.target, sort_order: f.sortOrder, created_at: iso(f.createdAt),
    })),
    budget_rules: rules.map((r) => ({
      id: r.id, category_id: r.categoryId, memo_keyword: r.memoKeyword, frame_id: r.frameId, priority: r.priority, created_at: iso(r.createdAt),
    })),
  };

  // 並びを日時（ミリ秒）→ id に固定する（stableSort の説明）
  const created = (r: { created_at: string }) => r.created_at;
  for (const key of ["accounts", "categories", "fixed_costs", "transactions", "receipts", "budget_frames", "budget_rules"] as const) {
    stableSort(data[key] as Array<{ id: string; created_at: string }>, created);
  }
  stableSort(data.csv_imports, (r) => r.imported_at);

  return {
    format: FULL_FORMAT,
    version: FULL_VERSION,
    exported_at: iso(now),
    definitions_version: DEFINITIONS_VERSION,
    counts: countBackup(data),
    data,
  };
}

// ─── 復元 ──────────────────────────────────────────────────

export type RestoreErrorKind = "not_empty" | "invalid" | "conflict";

/** 復元を止める理由。API はこれを 409／422 にする。message に中身（金額・メモ）は入れない */
export class RestoreError extends Error {
  constructor(public readonly kind: RestoreErrorKind, message: string) {
    super(message);
    this.name = "RestoreError";
  }
}

/** 帳簿が空か（費目・対応表は自動で作られるので数えない。ファイル冒頭の説明） */
export async function isLedgerEmpty(db: UserDb, userId: string): Promise<boolean> {
  const counts = await Promise.all([
    db.account.count({ where: { userId } }),
    db.category.count({ where: { userId } }),
    db.transaction.count({ where: { userId } }),
    db.fixedCost.count({ where: { userId } }),
    db.csvImport.count({ where: { userId } }),
    db.receipt.count({ where: { userId } }),
  ]);
  return counts.every((n) => n === 0);
}

/**
 * 参照先がそろっているかを書き込む前に確かめる（DB の外部キーに任せると、どこが悪いかが分からず 500 になる）。
 * 共通カテゴリーは名前と種別で今の DB の id に付け直した対応表を返す。
 */
async function resolveReferences(db: UserDb, data: BackupData): Promise<Map<string, string>> {
  // 1. 共通カテゴリー: バックアップの id → 今の DB の id（名前と種別で探す）
  const current = await db.category.findMany({ where: { userId: null }, select: { id: true, name: true, type: true } });
  const byName = new Map(current.map((c) => [`${c.type}\n${c.name}`, c.id]));
  const commonMap = new Map<string, string>();
  for (const c of data.common_categories) {
    const id = byName.get(`${c.type}\n${c.name}`);
    if (id) commonMap.set(c.id, id);
  }

  // 2. 参照先の集合
  const accounts = new Set(data.accounts.map((a) => a.id));
  const categories = new Set([...data.categories.map((c) => c.id), ...commonMap.keys()]);
  const fixed = new Set(data.fixed_costs.map((f) => f.id));
  const imports = new Set(data.csv_imports.map((i) => i.id));
  const txs = new Set(data.transactions.map((t) => t.id));
  const frames = new Set(data.budget_frames.map((f) => f.id));

  const missing = (table: string, what: string): never => {
    throw new RestoreError("invalid", `${table}に、${what}が見つからない行があります`);
  };
  const okCat = (id: string | null) => id === null || categories.has(id);
  for (const f of data.fixed_costs) {
    if (!accounts.has(f.account_id)) missing("定期", "口座");
    if (!okCat(f.category_id)) missing("定期", "カテゴリー");
  }
  for (const i of data.csv_imports) if (!accounts.has(i.account_id)) missing("取り込み履歴", "口座");
  for (const t of data.transactions) {
    if (!accounts.has(t.account_id)) missing("取引", "口座");
    if (!okCat(t.category_id)) missing("取引", "カテゴリー");
    if (t.fixed_cost_id !== null && !fixed.has(t.fixed_cost_id)) missing("取引", "定期");
    if (t.csv_import_id !== null && !imports.has(t.csv_import_id)) missing("取引", "取り込み履歴");
  }
  for (const r of data.receipts) if (!txs.has(r.transaction_id)) missing("レシート", "取引");
  for (const r of data.budget_rules) {
    if (!okCat(r.category_id)) missing("対応表", "カテゴリー");
    if (r.frame_id !== null && !frames.has(r.frame_id)) missing("対応表", "費目");
  }
  return commonMap;
}

/** DB のエラーを「同じ id が既にある」（conflict）か、それ以外かに分ける */
function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: string; message?: string; meta?: unknown };
  if (err.code === "P2002") return true;
  // ドライバーアダプター経由では Postgres のエラーコード（23505）がメタ情報やメッセージに入る
  const text = `${err.message ?? ""} ${JSON.stringify(err.meta ?? {})}`;
  return /23505|unique constraint|duplicate key/i.test(text);
}

/**
 * 完全形式を空の帳簿に入れる。withUserDb の中で呼ぶ（RLS の WITH CHECK も効く）。
 * 参照の向きに合わせて 口座 → カテゴリー → 定期 → 取り込み履歴 → 取引 → レシート → 費目 → 対応表 の順に入れる。
 */
export async function restoreBackup(db: UserDb, userId: string, backup: FullBackup): Promise<BackupCounts> {
  // 1. 空の帳簿だけ
  if (!(await isLedgerEmpty(db, userId))) {
    throw new RestoreError("not_empty", "帳簿が空ではありません。復元は、全削除して空にしてから行います");
  }
  const d = backup.data;

  // 2. 参照先を確かめ、共通カテゴリーの id を付け直す
  const commonMap = await resolveReferences(db, d);
  const cat = (id: string | null) => (id === null ? null : (commonMap.get(id) ?? id));

  try {
    // 3. 自動で作られた費目・対応表は、バックアップに費目があれば置き換える
    if (d.budget_frames.length > 0) {
      await db.budgetRule.deleteMany({ where: { userId } });
      await db.budgetFrame.deleteMany({ where: { userId } });
    }

    // 4. 参照の向きの順に入れる（id・作った日時を保つ）
    await db.account.createMany({
      data: d.accounts.map((a) => ({ id: a.id, userId, name: a.name, type: a.type, currency: a.currency, createdAt: new Date(a.created_at) })),
    });
    await db.category.createMany({
      data: d.categories.map((c) => ({
        id: c.id, userId, name: c.name, type: c.type, color: c.color, icon: c.icon, isDefault: false, createdAt: new Date(c.created_at),
      })),
    });
    await db.fixedCost.createMany({
      data: d.fixed_costs.map((f) => ({
        id: f.id,
        userId,
        accountId: f.account_id,
        categoryId: cat(f.category_id),
        name: f.name,
        amount: f.amount,
        type: f.type,
        cycle: f.cycle,
        billingDay: f.billing_day,
        billingMonth: f.billing_month,
        startDate: dateOnlyToDb(f.start_date),
        endDate: f.end_date ? dateOnlyToDb(f.end_date) : null,
        generatedThrough: f.generated_through ? dateOnlyToDb(f.generated_through) : null,
        isActive: f.is_active,
        matchNote: f.match_note,
        matchAnyAmount: f.match_any_amount,
        currency: f.currency,
        isSubscription: f.is_subscription,
        manageUrl: f.manage_url,
        cancelUrl: f.cancel_url,
        nextRenewalDate: f.next_renewal_date ? dateOnlyToDb(f.next_renewal_date) : null,
        paymentCard: f.payment_card,
        memo: f.memo,
        createdAt: new Date(f.created_at),
      })),
    });
    await db.csvImport.createMany({
      data: d.csv_imports.map((i) => ({
        id: i.id,
        userId,
        accountId: i.account_id,
        filename: i.filename,
        status: i.status,
        rowCount: i.row_count,
        skippedCount: i.skipped_count,
        importedAt: new Date(i.imported_at),
      })),
    });
    await db.transaction.createMany({
      data: d.transactions.map((t) => ({
        id: t.id,
        userId,
        accountId: t.account_id,
        categoryId: cat(t.category_id),
        fixedCostId: t.fixed_cost_id,
        amount: t.amount,
        type: t.type,
        kind: t.kind,
        transactionDate: dateOnlyToDb(t.transaction_date),
        note: t.note,
        source: t.source,
        csvImportId: t.csv_import_id,
        importKey: t.import_key,
        deletedAt: t.deleted_at ? new Date(t.deleted_at) : null,
        createdAt: new Date(t.created_at),
        updatedAt: new Date(t.updated_at),
      })),
    });
    await db.receipt.createMany({
      data: d.receipts.map((r) => ({
        id: r.id,
        userId,
        transactionId: r.transaction_id,
        merchant: r.merchant,
        purchasedAt: dateOnlyToDb(r.purchased_at),
        total: r.total,
        items: r.items as object[],
        model: r.model,
        createdAt: new Date(r.created_at),
      })),
    });
    await db.budgetFrame.createMany({
      data: d.budget_frames.map((f) => ({
        id: f.id, userId, name: f.name, monthlyLimit: f.monthly_limit, target: f.target, sortOrder: f.sort_order, createdAt: new Date(f.created_at),
      })),
    });
    await db.budgetRule.createMany({
      data: d.budget_rules.map((r) => ({
        id: r.id, userId, categoryId: cat(r.category_id), memoKeyword: r.memo_keyword, frameId: r.frame_id, priority: r.priority, createdAt: new Date(r.created_at),
      })),
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new RestoreError("conflict", "同じ id の行が既にあります（別の帳簿のバックアップは入れられません）");
    }
    throw e;
  }

  return countBackup(d);
}
