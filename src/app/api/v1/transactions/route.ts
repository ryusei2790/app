/**
 * @file api/v1/transactions/route.ts
 * @description 収支一覧取得（GET）・手動入力（POST）エンドポイント。
 * - GET: 年月・口座・カテゴリ・タイプ・ソースでフィルタリングして返す
 * - POST: source='manual' で収支を1件登録する
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, error, requireAuth, serializeTransaction } from "@/lib/api-helpers";
import type { CreateTransactionRequest } from "@/types/api";

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

  const transactions = await prisma.transaction.findMany({
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
  });

  return ok(transactions.map(serializeTransaction), { total: transactions.length });
}

/** POST /api/v1/transactions — 収支手動入力 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  let body: CreateTransactionRequest;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  // バリデーション
  const { account_id, amount, type, transaction_date } = body;
  if (!account_id || !amount || !type || !transaction_date) {
    return error(
      "VALIDATION_ERROR",
      "account_id, amount, type, transaction_date は必須です",
      422
    );
  }
  if (!["income", "expense"].includes(type)) {
    return error("VALIDATION_ERROR", "type は income または expense です", 422);
  }
  if (amount <= 0) {
    return error("VALIDATION_ERROR", "amount は正の値を指定してください", 422);
  }

  // 口座の所有権チェック（他ユーザーの口座を使えないよう確認）
  const account = await prisma.account.findFirst({
    where: { id: account_id, userId: user.id },
  });
  if (!account) {
    return error("NOT_FOUND", "指定された口座が見つかりません", 404);
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: account_id,
      categoryId: body.category_id ?? null,
      amount: amount,
      type,
      transactionDate: new Date(transaction_date),
      note: body.note ?? null,
      source: "manual",
    },
    include: {
      category: { select: { id: true, name: true, color: true, icon: true } },
      account: { select: { id: true, name: true, type: true } },
    },
  });

  return created(serializeTransaction(transaction));
}
