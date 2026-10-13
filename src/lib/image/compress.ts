/**
 * @file lib/image/compress.ts
 * @description ブラウザでレシート写真を縮小してから送る（テスト一覧 P4「送信前に縮小される」）。
 * スマホの写真（3〜5MB、4032×3024 など）を長辺1,568px・JPEG 品質80 にして約200KB にする。
 *   - 通信量と待ち時間が減る
 *   - AI の入力トークン（＝費用）が減る。1,568px は Claude の推奨上限で、Gemini でも読み取りに十分
 * computeTargetSize は純粋関数（単体テスト用）。compressImage はブラウザ専用（canvas を使う）。
 */

export const MAX_EDGE = 1568;
export const JPEG_QUALITY = 0.8;

/** 長辺を maxEdge に収めた大きさ。縦横比を保ち、小さい画像は拡大しない */
export function computeTargetSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * 画像ファイル → 縮小した JPEG の Blob。
 * createImageBitmap の imageOrientation: "from-image" で、スマホ写真の向き（EXIF）を反映してから描く。
 * 描き直すので EXIF（撮影場所の位置情報など）は送らない。
 */
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = computeTargetSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を処理できませんでした"))), "image/jpeg", JPEG_QUALITY)
  );
}
