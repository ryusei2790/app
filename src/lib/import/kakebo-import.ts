/**
 * @file lib/import/kakebo-import.ts
 * @description 家計簿アプリ形式の CSV 取り込みの DB 側（テスト一覧 I4〜I10）。route（api/v1/import）から呼ぶ。
 *
 *   loadPlan   … 計画に要るもの（自分の既存の目印・定期の自動取引・登録済みの定期）を読み、lib/import/plan.ts で計画を作る
 *   commitPlan … 計画のうち「新規」を取引に、選ばれた「予定」を毎月の定期支出にし、履歴（ファイル名と件数だけ）を残す
 *
 * どちらも withUserDb の中で呼ぶ（RLS が効く）。commit は呼ぶ側の1トランザクションの中で動くので、
 * 途中で失敗すれば取引・定期・履歴・新しいカテゴリー・口座のどれも残らない（I10）。
 * CSV の中身（金額・メモ）はログに出さない（S11）。ここでは console を使わない。
 */

import type { UserDb } from "@/lib/db";
import { dateOnlyToDb, dbToDateOnly } from "@/lib/date/jst";
import type { KeyedRow } from "@/lib/csv/import-key";
import { buildImportPlan, type ImportPlan } from "./plan";

/** 口座に "new" を指定したときに作る（または使う）口座の名前 */
export const MIGRATION_ACCOUNT_NAME = "家計簿アプリ（移行）";

const KEY_CHUNK = 5000;

/** 計画を作る。today は JST の今日（これより後の行が予定） */
export async function loadPlan(db: UserDb, userId: string, rows: KeyedRow[], today: string): Promise<ImportPlan> {
  // 1. このファイルの目印のうち、もう取り込んだもの（自分の分だけ。消した取引の目印も含める）
  const keys = rows.map((r) => r.importKey);
  const existingKeys = new Set<string>();
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    const found = await db.transaction.findMany({
      where: { userId, importKey: { in: keys.slice(i, i + KEY_CHUNK) } },
      select: { importKey: true },
    });
    for (const f of found) if (f.importKey) existingKeys.add(f.importKey);
  }

  // 2. ファイルの期間にある、定期から自動で作った取引（I8）
  const dates = rows.map((r) => r.date).sort();
  const autos =
    dates.length === 0
      ? []
      : await db.transaction.findMany({
          where: {
            userId,
            source: "auto",
            deletedAt: null,
            transactionDate: { gte: dateOnlyToDb(dates[0]), lte: dateOnlyToDb(dates[dates.length - 1]) },
          },
          select: { transactionDate: true, amount: true, type: true, category: { select: { name: true } } },
        });

  // 3. 登録済みの毎月の定期（同じ予定から定期を2つ作らないため）
  const fixed = await db.fixedCost.findMany({
    where: { userId, isActive: true, cycle: "monthly" },
    select: { amount: true, type: true, billingDay: true, category: { select: { name: true } } },
  });

  return buildImportPlan({
    rows,
    today,
    existingKeys,
    autoTransactions: autos.map((a) => ({
      date: dbToDateOnly(a.transactionDate),
      amount: Number(a.amount),
      type: a.type as "income" | "expense",
      categoryName: a.category?.name ?? "",
    })),
    scheduled: fixed
      .filter((f) => f.billingDay !== null)
      .map((f) => ({
        amount: Number(f.amount),
        type: f.type as "income" | "expense",
        categoryName: f.category?.name ?? "",
        billingDay: f.billingDay!,
      })),
  });
}

const catKey = (name: string, type: string) => `${type}\n${name}`;

/**
 * カテゴリー名＋支出/収入 → カテゴリー id。自分のカテゴリー → 共通カテゴリーの順で探し、無ければ自分のカテゴリーとして作る（I9）。
 * 「その他」は支出と収入の両方に使われるので、名前だけでなく種別でも分ける。
 */
export async function resolveCategories(
  db: UserDb,
  userId: string,
  wanted: Array<{ name: string; type: "income" | "expense" }>
): Promise<Map<string, string>> {
  const visible = await db.category.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    select: { id: true, name: true, type: true, userId: true },
  });
  const map = new Map<string, string>();
  // 共通 → 自分の順に入れて、同じ名前なら自分のカテゴリーで上書きする
  for (const c of [...visible].sort((a, b) => (a.userId === null ? 0 : 1) - (b.userId === null ? 0 : 1))) {
    map.set(catKey(c.name, c.type), c.id);
  }
  for (const w of wanted) {
    if (w.name === "" || map.has(catKey(w.name, w.type))) continue;
    const created = await db.category.create({ data: { userId, name: w.name, type: w.type }, select: { id: true } });
    map.set(catKey(w.name, w.type), created.id);
  }
  return map;
}

export function categoryIdOf(map: Map<string, string>, row: { categoryName: string; type: string }): string | null {
  return row.categoryName === "" ? null : (map.get(catKey(row.categoryName, row.type)) ?? null);
}

/** "new" なら「家計簿アプリ（移行）」口座を探すか作る。それ以外は自分の口座か確かめる。無ければ null */
export async function resolveAccount(db: UserDb, userId: string, accountId: string): Promise<string | null> {
  if (accountId === "new") {
    const found = await db.account.findFirst({ where: { userId, name: MIGRATION_ACCOUNT_NAME }, select: { id: true } });
    if (found) return found.id;
    const created = await db.account.create({ data: { userId, name: MIGRATION_ACCOUNT_NAME, type: "cash" }, select: { id: true } });
    return created.id;
  }
  const own = await db.account.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  return own?.id ?? null;
}

export interface CommitResult {
  importId: string;
  imported: number;
  skipped: number;
  scheduled: number;
}

/**
 * 計画を保存する。scheduleKeys は本人が「定期にする」を選んだ予定の行の目印。
 * 登録済み（alreadyScheduled）の予定は選ばれていても作らない（同じ定期を2つ作らない）。
 */
export async function commitPlan(
  db: UserDb,
  userId: string,
  accountId: string,
  filename: string,
  plan: ImportPlan,
  scheduleKeys: Set<string>
): Promise<CommitResult> {
  const toSchedule = plan.future.filter((f) => scheduleKeys.has(f.importKey) && !f.alreadyScheduled);

  // 1. 使うカテゴリーをそろえる（無ければ作る）
  const categories = await resolveCategories(
    db,
    userId,
    [...plan.fresh, ...toSchedule].map((r) => ({ name: r.categoryName, type: r.type }))
  );

  // 2. 履歴（ファイル名と件数だけ。CSV の中身は残さない: S11）
  const history = await db.csvImport.create({
    data: {
      userId,
      accountId,
      filename: filename.slice(0, 200),
      status: "success",
      rowCount: plan.fresh.length,
      skippedCount: plan.already.length + plan.recurringDone.length,
    },
    select: { id: true },
  });

  // 3. 新規の行を取引に。目印の一意索引が最後の守り（preview と commit の間に別の取り込みが走っても増えない）
  const inserted = await db.transaction.createMany({
    data: plan.fresh.map((r) => ({
      userId,
      accountId,
      categoryId: categoryIdOf(categories, r),
      amount: r.amount,
      type: r.type,
      transactionDate: dateOnlyToDb(r.date),
      note: r.note === "" ? null : r.note,
      source: "csv",
      csvImportId: history.id,
      importKey: r.importKey,
    })),
    skipDuplicates: true,
  });

  // 4. 選ばれた予定を毎月・その日の定期に（31日は月末に丸めるのは定期支出側: lib/fixed-costs/schedule.ts）
  for (const f of toSchedule) {
    await db.fixedCost.create({
      data: {
        userId,
        accountId,
        categoryId: categoryIdOf(categories, f),
        name: (f.note || f.categoryName || "定期").slice(0, 100),
        amount: f.amount,
        type: f.type,
        cycle: "monthly",
        billingDay: f.billingDay,
        startDate: dateOnlyToDb(f.date),
      },
    });
  }

  // 一意索引でとばされた分（同時に取り込まれた行）も「とばした」に数える
  const raced = plan.fresh.length - inserted.count;
  if (raced > 0) {
    await db.csvImport.update({
      where: { id: history.id },
      data: { rowCount: inserted.count, skippedCount: plan.already.length + plan.recurringDone.length + raced },
    });
  }

  return {
    importId: history.id,
    imported: inserted.count,
    skipped: plan.already.length + plan.recurringDone.length + raced,
    scheduled: toSchedule.length,
  };
}
