/**
 * @file api/v1/transactions/route.ts
 * @description 収支一覧取得（GET）・手動入力（POST）エンドポイント。
 * - GET: 年月・口座・カテゴリ・タイプ・ソースでフィルタリングして返す
 * - POST: source='manual' で収支を1件登録する
 * DB には withUserDb（RLS が効く）経由でだけ触る。user_id は body からは取らず、必ずログイン中のユーザー。
 */

import { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { checkRefs, normalizeCategoryId } from "@/lib/ownership";
import { ok, created, error, requireAuth, readJsonBody, serializeTransaction } from "@/lib/api-helpers";

/** GET /api/v1/transactions — 収支一覧取得 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? "");
  const month = parseInt(searchParams.get("month") ?? "");

  // year・month は必須パラメータ
  if (isNaN(year) || isNaN(month)) {
    return error("VALIDATION_ERROR", "year と month は必須です", 422);
  }

  const accountId = searchParams.get("account_id");
  const categoryId = searchParams.get("category_id");
  const type = searchParams.get("type");
  const source = searchParams.get("source");

  // 指定年月の開始日・終了日を計算
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // 月末日

  const transactions = await withUserDb(user.id, (db) =>
    db.transaction.findMany({
      where: {
        userId: user.id,
        deletedAt: null, // 論理削除されていないものだけ
        transactionDate: { gte: startDate, lte: endDate },
        ...(accountId ? { accountId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(type ? { type } : {}),
        ...(source ? { source } : {}),
      },
      include: {
        category: { select: { id: true, name: true, color: true, icon: true } },
        account: { select: { id: true, name: true, type: true } },
      },
      orderBy: { transactionDate: "desc" },
    })
  );

  return ok(transactions.map(serializeTransaction), { total: transactions.length });
}

/** POST /api/v1/transactions — 収支手動入力 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  // バリデーション
  const { account_id, amount, type, transaction_date } = body;
  if (!account_id || !amount || !type || !transaction_date) {
    return error(
      "VALIDATION_ERROR",
      "account_id, amount, type, transaction_date は必須です",
      422
    );
  }
  if (!["income", "expense"].includes(type as string)) {
    return error("VALIDATION_ERROR", "type は income または expense です", 422);
  }
  if ((amount as number) <= 0) {
    return error("VALIDATION_ERROR", "amount は正の値を指定してください", 422);
  }
  const categoryId = normalizeCategoryId(body.category_id) ?? null;

  return withUserDb(user.id, async (db) => {
    // 口座・カテゴリの所有確認（他ユーザーのものを使えないよう確認。DB の RLS でも同じ確認をしている）
    const refs = await checkRefs(db, user.id, { accountId: account_id, categoryId });
    if (!refs.ok) return error("NOT_FOUND", refs.message, 404);

    const transaction = await db.transaction.create({
      data: {
        userId: user.id,
        accountId: account_id as string,
        categoryId: categoryId as string | null,
        amount: amount as number,
        type: type as string,
        transactionDate: new Date(transaction_date as string),
        note: (body.note as string | undefined) ?? null,
        source: "manual",
      },
      include: {
        category: { select: { id: true, name: true, color: true, icon: true } },
        account: { select: { id: true, name: true, type: true } },
      },
    });
    return created(serializeTransaction(transaction));
  });
}
