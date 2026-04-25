/**
 * @file api/v1/accounts/route.ts
 * @description 口座一覧取得（GET）・口座作成（POST）エンドポイント。
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, error, requireAuth, serializeAccount } from "@/lib/api-helpers";
import type { CreateAccountRequest } from "@/types/api";

/** GET /api/v1/accounts — 口座一覧 */
export async function GET(_request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const accounts = await prisma.account.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  return ok(accounts.map(serializeAccount), { total: accounts.length });
}

/** POST /api/v1/accounts — 口座作成 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  let body: CreateAccountRequest;
  try {
    body = await request.json();
  } catch {
    return error("VALIDATION_ERROR", "リクエストボディが不正です", 422);
  }

  if (!body.name || !body.type) {
    return error("VALIDATION_ERROR", "name と type は必須です", 422);
  }
  if (!["cash", "credit_card", "bank"].includes(body.type)) {
    return error(
      "VALIDATION_ERROR",
      "type は cash / credit_card / bank のいずれかです",
      422
    );
  }

  const account = await prisma.account.create({
    data: {
      userId: user.id,
      name: body.name,
      type: body.type,
      currency: body.currency ?? "JPY",
    },
  });

  return created(serializeAccount(account));
}
