/**
 * @file api/v1/fixed-costs/route.ts
 * @description 固定費一覧取得（GET）・固定費登録（POST）エンドポイント。
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, error, requireAuth, serializeFixedCost } from "@/lib/api-helpers";
import type { CreateFixedCostRequest } from "@/types/api";

/** GET /api/v1/fixed-costs — 固定費一覧 */
export async function GET(_request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const fixedCosts = await prisma.fixedCost.findMany({
    where: { userId: user.id },
    include: {
      category: { select: { id: true, name: true, color: true } },
      account: { select: { id: true, name: true, type: true } },
    },
    orderBy: { billingDay: "asc" },
  });

  return ok(fixedCosts.map(serializeFixedCost), { total: fixedCosts.length });
}

/** POST /api/v1/fixed-costs — 固定費登録 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  let body: CreateFixedCostRequest;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  const { account_id, name, amount, billing_day } = body;
  if (!account_id || !name || !amount || !billing_day) {
    return error(
      "VALIDATION_ERROR",
      "account_id, name, amount, billing_day は必須です",
      422
    );
  }
  if (billing_day < 1 || billing_day > 31) {
    return error("VALIDATION_ERROR", "billing_day は 1〜31 で指定してください", 422);
  }
  if (amount <= 0) {
    return error("VALIDATION_ERROR", "amount は正の値を指定してください", 422);
  }

  // 口座の所有権チェック
  const account = await prisma.account.findFirst({
    where: { id: account_id, userId: user.id },
  });
  if (!account) {
    return error("NOT_FOUND", "指定された口座が見つかりません", 404);
  }

  const fixedCost = await prisma.fixedCost.create({
    data: {
      userId: user.id,
      accountId: account_id,
      categoryId: body.category_id ?? null,
      name,
      amount,
      billingDay: billing_day,
      isActive: body.is_active ?? true,
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
      account: { select: { id: true, name: true, type: true } },
    },
  });

  return created(serializeFixedCost(fixedCost));
}
