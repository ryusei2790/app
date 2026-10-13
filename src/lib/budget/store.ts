/**
 * @file lib/budget/store.ts
 * @description 予算の枠・対応表を DB から読む／初回に作る（テスト一覧 M1）。api/v1/budget/* から withUserDb の中で呼ぶ。
 *
 * ensureBudgetDefaults: 枠が1つも無い人にだけ、lib/budget/defaults.ts の8費目と対応表を作る。
 *   2回呼んでも増えない（枠があれば何もしない。枠は (user_id, name) で一意）。
 *   対応表が指すカテゴリー（外食費・趣味など）が無ければ、自分のカテゴリーとして作る
 *   （CSV 取り込みと同じ lib/import/kakebo-import.ts の resolveCategories を使い、名前の照合をそろえる）。
 */

import type { UserDb } from "@/lib/db";
import { resolveCategories } from "@/lib/import/kakebo-import";
import { DEFAULT_FRAMES, DEFAULT_RULES } from "./defaults";
import type { BudgetRule } from "./classify";
import type { BudgetFrame } from "./summary";

export async function ensureBudgetDefaults(db: UserDb, userId: string): Promise<void> {
  const existing = await db.budgetFrame.count({ where: { userId } });
  if (existing > 0) return;

  // 1. 枠（同時に2回走っても一意制約で1回分だけ入る）
  await db.budgetFrame.createMany({
    data: DEFAULT_FRAMES.map((f, i) => ({ userId, name: f.name, monthlyLimit: f.monthlyLimit, target: f.target, sortOrder: i })),
    skipDuplicates: true,
  });
  const frames = await db.budgetFrame.findMany({ where: { userId }, select: { id: true, name: true } });
  const frameId = new Map(frames.map((f) => [f.name, f.id]));

  // 2. 対応表が指すカテゴリー（支出）をそろえる
  const categories = await resolveCategories(
    db,
    userId,
    DEFAULT_RULES.filter((r) => "categoryName" in r).map((r) => ({ name: (r as { categoryName: string }).categoryName, type: "expense" as const }))
  );

  // 3. 対応表（上から順に priority）
  await db.budgetRule.createMany({
    data: DEFAULT_RULES.map((r, i) => ({
      userId,
      categoryId: "categoryName" in r ? (categories.get(`expense\n${r.categoryName}`) ?? null) : null,
      memoKeyword: "memoKeyword" in r ? r.memoKeyword : null,
      frameId: r.frame === null ? null : (frameId.get(r.frame) ?? null),
      priority: i,
    })),
  });
}

export async function loadFrames(db: UserDb, userId: string): Promise<BudgetFrame[]> {
  const rows = await db.budgetFrame.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } });
  return rows.map((f) => ({ id: f.id, name: f.name, monthlyLimit: f.monthlyLimit, target: f.target, sortOrder: f.sortOrder }));
}

export interface RuleWithCategory extends BudgetRule {
  categoryName: string | null;
  categoryType: string | null;
}

export async function loadRules(db: UserDb, userId: string): Promise<RuleWithCategory[]> {
  const rows = await db.budgetRule.findMany({
    where: { userId },
    include: { category: { select: { name: true, type: true } } },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    memoKeyword: r.memoKeyword,
    frameId: r.frameId,
    priority: r.priority,
    categoryName: r.category?.name ?? null,
    categoryType: r.category?.type ?? null,
  }));
}

/** API の返し方（snake_case） */
export function serializeFrame(f: BudgetFrame) {
  return { id: f.id, name: f.name, monthly_limit: f.monthlyLimit, target: f.target, sort_order: f.sortOrder };
}

export function serializeRule(r: RuleWithCategory) {
  return {
    id: r.id,
    category_id: r.categoryId,
    category_name: r.categoryName,
    memo_keyword: r.memoKeyword,
    frame_id: r.frameId,
    priority: r.priority,
  };
}
