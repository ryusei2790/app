/**
 * @file api/v1/receipts/route.ts
 * @description 利用者が確認・修正したレシートを保存する（テスト一覧 P8・S7）。
 * 取引（transactions, source='receipt', 支出）とレシート情報（receipts）を1つの DB トランザクションで作る。
 * 明細に category_id が付いていれば、カテゴリごとに取引を分けて作る（mywork#229。lib/receipt/split.ts）。
 * レシート情報は金額のいちばん大きい取引にぶら下げ、明細（カテゴリ付き）はそこに残す。
 * AI の読み取り結果ではなく、ここに送られた値（＝利用者が確定した値）だけが入る。
 * user は JWT からだけ取る。口座・カテゴリは自分のもの（カテゴリは共通も可）だけ（S3・S7）。
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { withUserDb } from "@/lib/db";
import { checkCategory, checkRefs, normalizeCategoryId } from "@/lib/ownership";
import { splitByCategory } from "@/lib/receipt/split";
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
  const categoryId = (normalizeCategoryId(body.category_id) ?? null) as string | null; // 中身は checkRefs で確かめる

  // 明細にカテゴリが1つでも付いていれば仕分ける。付いていない明細は画面で選んだカテゴリ（無ければ未分類）
  const split = r.items.some((i) => i.category_id)
    ? splitByCategory(r.items.map((i) => ({ amount: i.amount, categoryId: i.category_id ?? categoryId })), r.total)
    : [{ categoryId, amount: r.total }];

  return withUserDb(user.id, async (db) => {
    const refs = await checkRefs(db, user.id, { accountId: body.account_id, categoryId });
    if (!refs.ok) return error("NOT_FOUND", refs.message, 404);
    for (const part of split) {
      const c = await checkCategory(db, user.id, part.categoryId);
      if (!c.ok) return error("NOT_FOUND", c.message, 404);
    }

    const txs = [];
    for (const part of split) {
      txs.push(
        await db.transaction.create({
          data: {
            userId: user.id,
            accountId: body.account_id as string,
            categoryId: part.categoryId,
            amount: part.amount,
            type: "expense",
            transactionDate: dateOnlyToDb(r.transactionDate),
            note: r.merchant,
            source: "receipt",
          },
          include: {
            category: { select: { id: true, name: true, color: true } },
            account: { select: { id: true, name: true, type: true } },
          },
        })
      );
    }
    const receipt = await db.receipt.create({
      data: {
        userId: user.id,
        transactionId: txs[0].id,
        merchant: r.merchant,
        purchasedAt: dateOnlyToDb(r.transactionDate),
        total: r.total,
        items: r.items,
        model: r.model,
      },
    });
    return created({
      transaction: serializeTransaction(txs[0]),
      transactions: txs.map(serializeTransaction),
      receipt: { id: receipt.id, merchant: receipt.merchant, total: Number(receipt.total), items: r.items },
    });
  });
}
