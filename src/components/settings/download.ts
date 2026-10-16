/**
 * @file components/settings/download.ts
 * @description 書き出し API（/api/v1/export）の応答をファイルとして端末に保存するブラウザ側の部品（mywork#425 第2弾）。
 *
 * なぜ <a href download> にしないか: 全削除の前のバックアップは「保存できたこと」を確かめてから次へ進めたい。
 * fetch で応答を確かめ（401・500 なら保存しない）、Blob にしてから a.click() で保存する。
 * ファイル名はサーバーの Content-Disposition に従う（日付入りの英数字の名前）。
 */

export type DownloadResult = { ok: true; filename: string; text: string } | { ok: false; message: string };

/** API を呼んでファイルとして保存する。text は保存した中身（バックアップの件数を画面に出すため） */
export async function downloadFromApi(url: string, fallbackName: string): Promise<DownloadResult> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    return { ok: false, message: "通信できませんでした。電波の良いところでもう一度試してください" };
  }
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    return { ok: false, message: json?.error?.message ?? "書き出しに失敗しました" };
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const blob = await res.blob();
  const text = await blob.text();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐに解放すると保存が始まる前に消える端末があるので、少し待ってから
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return { ok: true, filename, text };
}
