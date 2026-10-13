/**
 * @file lib/receipt/prompt.ts
 * @description AI に渡す指示文。どの提供元にも同じ文を送る。
 * 利用者の情報（ユーザー ID・メール・名前）は入れない（P9）。画像と、この固定の文だけを送る。
 * 返してほしい形は lib/receipt/schema.ts の ReceiptAiResultSchema と一致させる。
 */

export const RECEIPT_PROMPT = `この画像はお店のレシートです。次の JSON だけを返してください（説明文は不要）。

{
  "is_receipt": レシートの写真なら true、違えば false,
  "currency": 通貨コード（日本円なら "JPY"）,
  "language": レシートの主な言語（日本語なら "ja"、英語なら "en"）,
  "merchant": 店名（読めなければ null）,
  "purchased_at": 購入日 "YYYY-MM-DD"（和暦は西暦に直す。読めなければ null）,
  "total": お支払い合計の金額（税込・整数の円。読めなければ null）,
  "items": [ { "name": 品名, "quantity": 数量（無ければ null）, "amount": その行の金額（整数の円。値引きは負の数） } ]
}

注意:
- 小計・お預かり・お釣り・ポイントは items に入れない
- 値引き・クーポンの行は amount を負の数で items に入れる
- 推測で埋めない。読めない項目は null にする`;
