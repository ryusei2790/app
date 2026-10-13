/**
 * @file api/v1/receipts/route.ts
 * @description 利用者が確認・修正したレシートを保存する（テスト一覧 P8・S7）。
 * 取引（transactions, source='receipt', 支出）とレシート情報（receipts）を1つの DB トランザクションで作る。
 * AI の読み取り結果ではなく、ここに送られた値（＝利用者が確定した値）だけが入る。
 * user は JWT からだけ取る。口座・カテゴリは自分のもの（カテゴリは共通も可）だけ（S3・S7）。
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { withUserDb } from "@/lib/db";
import { checkRefs, normalizeCategoryId } from "@/lib/ownership";
import { parseReceiptInput } from "@/lib/validation/receipt";
import { dateOnlyToDb } from "@/lib/date/jst";
import { created, error, readJsonBody, requireAuth, serializeTransaction } from "@/lib/api-helpers";

/** POST /api/v1/receipts — 確定したレシートを保存 */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const parsed = await readJsonBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  if (!body.account_id) return error("VALIDATION_ERROR", "account_id は必須です", 422);
  const input = parseReceiptInput(body);
  if (!input.ok) return error("VALIDATION_ERROR", input.message, 422);
  const r = input.value;
  const categoryId = normalizeCategoryId(body.category_id) ?? null;

  return withUserDb(user.id, async (db) => {
    const refs = await checkRefs(db, user.id, { accountId: body.account_id, categoryId });
    if (!refs.ok) return error("NOT_FOUND", refs.message, 404);

    const tx = await db.transaction.create({
      data: {
        userId: user.id,
        accountId: body.account_id as string,
        categoryId: categoryId as string | null,
        amount: r.total,
        type: "expense",
        transactionDate: dateOnlyToDb(r.transactionDate),
        note: r.merchant,
        source: "receipt",
      },
      include: {
        category: { select: { id: true, name: true, color: true } },
        account: { select: { id: true, name: true, type: true } },
      },
    });
    const receipt = await db.receipt.create({
      data: {
        userId: user.id,
        transactionId: tx.id,
        merchant: r.merchant,
        purchasedAt: dateOnlyToDb(r.transactionDate),
        total: r.total,
        items: r.items,
        model: r.model,
      },
    });
    return created({
      transaction: serializeTransaction(tx),
      receipt: { id: receipt.id, merchant: receipt.merchant, total: Number(receipt.total), items: r.items },
    });
  });
}
