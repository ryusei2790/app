/**
 * @file lib/ownership.ts
 * @description 「参照先が自分のものか」をアプリ側で確かめる部品（S3）。
 * 取引・固定費を作る／更新するとき、body の account_id / category_id が
 * ログイン中のユーザーのもの（カテゴリは共通カテゴリも可）かを確認する。
 * DB 側の RLS（WITH CHECK）でも同じことを確かめているが、
 * こちらで先に止めることで、分かりやすい 404 を返し、500（DB エラー）にしない。
 */

import { isUuid, type UserDb } from "./db";

export type RefCheck = { ok: true } | { ok: false; message: string };

/** 口座が自分のものか */
export async function checkAccount(db: UserDb, userId: string, accountId: unknown): Promise<RefCheck> {
  if (!isUuid(accountId)) return { ok: false, message: "指定された口座が見つかりません" };
  const found = await db.account.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  return found ? { ok: true } : { ok: false, message: "指定された口座が見つかりません" };
}

/** カテゴリが自分のもの、または共通カテゴリか。null（未分類）は可 */
export async function checkCategory(db: UserDb, userId: string, categoryId: unknown): Promise<RefCheck> {
  if (categoryId === null || categoryId === undefined) return { ok: true };
  if (!isUuid(categoryId)) return { ok: false, message: "指定されたカテゴリが見つかりません" };
  const found = await db.category.findFirst({
    where: { id: categoryId, OR: [{ userId: null }, { userId }] },
    select: { id: true },
  });
  return found ? { ok: true } : { ok: false, message: "指定されたカテゴリが見つかりません" };
}

/**
 * まとめて確認する。undefined のものは確認しない（更新で触らない項目）。
 * 最初に見つかった問題を返す。
 */
export async function checkRefs(
  db: UserDb,
  userId: string,
  refs: { accountId?: unknown; categoryId?: unknown }
): Promise<RefCheck> {
  if (refs.accountId !== undefined) {
    const r = await checkAccount(db, userId, refs.accountId);
    if (!r.ok) return r;
  }
  if (refs.categoryId !== undefined) {
    const r = await checkCategory(db, userId, refs.categoryId);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** body の category_id を正規化する（"" や null は「未分類」= null、未指定は undefined のまま） */
export function normalizeCategoryId(v: unknown): unknown {
  if (v === "" || v === null) return null;
  return v;
}
