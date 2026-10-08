/**
 * @file lib/receipt/image.ts
 * @description サーバーに届いたレシート画像の検査（テスト一覧 P4）。AI に送る前・回数を数える前に行う。
 *
 * - 大きさ: 2MB まで（ブラウザで長辺1,568px・JPEG 品質80に縮小すると約200KB なので十分な余裕）
 * - 形式: 先頭のバイト（マジックナンバー）で JPEG・PNG・WebP だけを通す。ファイル名や Content-Type は偽れるので見ない
 * - 壊れ: 終わりの印が無い（途中で切れた）ものを止める。JPEG は FFD9、PNG は IEND、WebP は RIFF の長さ
 * 画像はこの関数の中でもどこにも保存しない（P5）。
 */

export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

export type ImageCheck =
  | { ok: true; mediaType: "image/jpeg" | "image/png" | "image/webp" }
  | { ok: false; code: "too_large" | "not_image" | "corrupt"; status: 413 | 415 | 422; message: string };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

export function validateReceiptImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length > MAX_RECEIPT_BYTES) {
    return { ok: false, code: "too_large", status: 413, message: "画像が大きすぎます（2MB まで）。" };
  }
  const notImage = { ok: false as const, code: "not_image" as const, status: 415 as const, message: "JPEG・PNG・WebP の画像を選んでください。" };
  const corrupt = { ok: false as const, code: "corrupt" as const, status: 422 as const, message: "画像が壊れているようです。撮り直してください。" };

  // JPEG: FF D8 FF で始まり、FF D9 で終わる
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const n = bytes.length;
    return n >= 4 && bytes[n - 2] === 0xff && bytes[n - 1] === 0xd9 ? { ok: true, mediaType: "image/jpeg" } : corrupt;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A で始まり、最後のチャンクが IEND（長さ4＋"IEND"＋CRC4）
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const n = bytes.length;
    return n >= 20 && startsWith(bytes, ascii("IEND"), n - 8) ? { ok: true, mediaType: "image/png" } : corrupt;
  }
  // WebP: "RIFF" <長さ(LE)> "WEBP"。RIFF の長さ + 8 がファイルの長さと一致する
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    const riffSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
    return riffSize + 8 === bytes.length ? { ok: true, mediaType: "image/webp" } : corrupt;
  }
  return notImage;
}
