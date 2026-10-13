/*
 * public/sw.js — 最小の Service Worker（Issue #229 / テスト一覧 W2）
 *
 * 役割は2つだけ:
 *   1. ホーム画面に追加できる条件を満たす（Service Worker があること）
 *   2. オフラインで画面を開いたとき、真っ白ではなく「接続が必要です」を出す
 *
 * 家計簿は他人に見られたくないお金の記録なので、端末には何も残さない:
 *   - Cache API・IndexedDB を使わない（画面もデータもキャッシュしない）
 *   - 書き込みを溜めて後で送る仕組み（Background Sync）を持たない。オフラインの保存は失敗として画面に出す
 * API や画像などの通信には一切手を出さない（ブラウザがそのまま送る）。
 */

const OFFLINE_HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>接続が必要です</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,-apple-system,"Hiragino Sans",sans-serif;background:#f9fafb;color:#111827}
  main{max-width:20rem;padding:1.5rem;text-align:center}
  button{margin-top:1rem;padding:.6rem 1.2rem;border:0;border-radius:.5rem;background:#2563eb;color:#fff;font-size:1rem}
</style></head>
<body><main>
  <p style="font-size:2rem;margin:0">📶</p>
  <h1 style="font-size:1.1rem">接続が必要です</h1>
  <p style="font-size:.9rem;color:#4b5563">インターネットにつながってから開き直してください。オフラインの間は記録できません。</p>
  <button onclick="location.reload()">もう一度読み込む</button>
</main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => new Response(OFFLINE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } })
      )
    );
  }
  // それ以外（API・JS・画像など）は respondWith しない＝ブラウザがそのまま通信する
});
