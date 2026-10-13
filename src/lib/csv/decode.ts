/**
 * @file lib/csv/decode.ts
 * @description CSV ファイルのバイト列を文字列にする（テスト一覧 I1・I11）。
 *
 * 家計簿アプリの書き出しは UTF-8（README は BOM 付きと書くが、実物は BOM 無し）。
 * 古いアプリや Excel で保存し直した CSV は Shift_JIS のことがあるので、
 *   1. UTF-8 として厳密に読む（壊れたバイトがあれば例外にする fatal: true）
 *   2. 読めなければ Shift_JIS として読む
 * の順で試す。先頭の BOM（U+FEFF）は取り除く（ヘッダーの判定がずれないように）。
 */

/** バイト列 → 文字列。UTF-8（BOM 有無）→ Shift_JIS の順に試す */
export function decodeCsv(bytes: Uint8Array | ArrayBuffer): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text: string;
  try {
    // ignoreBOM: false（既定）なので UTF-8 の BOM はここで消える
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // UTF-8 として不正なバイト列 → Shift_JIS とみなす（Node・ブラウザとも標準で対応）
    text = new TextDecoder("shift_jis").decode(buf);
  }
  // 念のため残った BOM も取る（二重 BOM などの変なファイル対策）
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
