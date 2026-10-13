/**
 * @file api/v1/receipts/parse/route.ts
 * @description レシート画像 → 取引の下書き（テスト一覧 D・E）。**保存はしない**（保存は POST /api/v1/receipts）。
 *
 * 流れ（設計書 B2〜B4）:
 *   1. ログイン確認（401）
 *   2. 画像の検査: 大きさ（413）・形式（415）・壊れ（422）。回数を数える前に行う
 *   3. 回数の予約: 1人 1日5・月30、全体 月3,000（429 と日本語の理由）
 *   4. AI で読む（30秒で打ち切り・1回だけ再試行）
 *        失敗 → 予約を failed に（数えない）＋ 503 で手入力へ案内（P6）
 *        取り消し → cancelled（数えない）
 *   5. 応答を検査して下書きにし、予約を succeeded に（トークン数・費用だけ記録）
 * 画像はメモリ上だけで扱い、DB・ストレージ・ログのどこにも残さない（P5）。
 * user は JWT（requireAuth）からだけ取り、body の user_id などは見ない（S7）。
 */

import { requireAuth, ok, error } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { validateReceiptImage } from "@/lib/receipt/image";
import { getReceiptProvider } from "@/lib/receipt/providers";
import { readReceipt, ReceiptReadError } from "@/lib/receipt/parser";
import { finishReceiptParse, getReceiptUsage, reserveReceiptParse } from "@/lib/quota";
import type { ErrorCode } from "@/types/api";

const IMAGE_ERROR: Record<"too_large" | "not_image" | "corrupt", ErrorCode> = {
  too_large: "PAYLOAD_TOO_LARGE",
  not_image: "UNSUPPORTED_MEDIA_TYPE",
  corrupt: "VALIDATION_ERROR",
};

const MANUAL = "手入力なら今すぐ登録できます。";

/** POST /api/v1/receipts/parse — multipart/form-data の image（JPEG・PNG・WebP、2MB まで） */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;

  // 1. 画像を受け取って検査する（ここで弾いたものは回数に数えない）
  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get("image");
  } catch {
    // 下で 422
  }
  if (!(file instanceof Blob) || file.size === 0) {
    return error("VALIDATION_ERROR", "レシートの画像を選んでください", 422);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateReceiptImage(bytes);
  if (!check.ok) return error(IMAGE_ERROR[check.code], check.message, check.status);

  // 2. 提供元の設定を確かめる（鍵が無い等）。回数を押さえる前に止める
  let provider;
  try {
    provider = getReceiptProvider();
  } catch (e) {
    console.error("[receipts/parse] 提供元の設定エラー", e instanceof Error ? e.message : "unknown");
    return error("AI_UNAVAILABLE", `いまレシート読み取りを使えません。${MANUAL}`, 503);
  }

  // 3. 回数を予約
  const quota = await reserveReceiptParse(user);
  if (!quota.ok) return error("RATE_LIMITED", quota.message, 429, { reason: quota.reason });

  // 4. 読む
  try {
    const result = await readReceipt(provider, bytes, check.mediaType, { today: todayJst(), signal: request.signal });
    await finishReceiptParse(quota.logId, user.id, "succeeded", { model: result.model, ...result.usage });
    return ok({ draft: result.draft, model: result.model, usage: await getReceiptUsage(user) });
  } catch (e) {
    const reason = e instanceof ReceiptReadError ? e.reason : "provider_error";
    await finishReceiptParse(quota.logId, user.id, reason === "cancelled" ? "cancelled" : "failed");
    // 理由の種類だけ残す（画像・応答の中身は出さない）
    console.error("[receipts/parse] 読み取り失敗", reason);
    if (reason === "cancelled") return error("CANCELLED", "読み取りを取り消しました。", 499);
    return error(
      "AI_UNAVAILABLE",
      `レシートを読み取れませんでした（回数は減っていません）。時間をおいて試すか、${MANUAL}`,
      503
    );
  }
}
