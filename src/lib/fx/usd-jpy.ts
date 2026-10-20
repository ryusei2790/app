/**
 * @file lib/fx/usd-jpy.ts
 * @description ドル円の相場を取る（Issue #229 残り②: ドル建ての定期を円に直す）。
 *
 * 取り先は Frankfurter（欧州中央銀行の参照レート。鍵不要・無料）。その日の分がまだ無い・土日祝は
 * 直前の営業日のレートが返る。取れなかったときは null を返し、呼ぶ側が「今回は作らず次に回す」を決める。
 * 同じ日付は1回の起動の中で使い回す（定期が何件あっても1日1回だけ取りに行く）。
 */

export type UsdJpyRate = (date: string | "latest") => Promise<number | null>;

const BASE = "https://api.frankfurter.dev/v1";
const cache = new Map<string, number>();

/** "YYYY-MM-DD" か "latest" のドル円（1ドル何円か）。失敗は null */
export const getUsdJpyRate: UsdJpyRate = async (date) => {
  const hit = cache.get(date);
  if (hit !== undefined) return hit;
  try {
    const res = await fetch(`${BASE}/${date}?base=USD&symbols=JPY`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const rate = parseRate(await res.json());
    if (rate !== null) cache.set(date, rate);
    return rate;
  } catch {
    return null;
  }
};

/** Frankfurter の応答 { rates: { JPY: 151.23 } } から値を取り出す。形が違えば null */
export function parseRate(json: unknown): number | null {
  const v = (json as { rates?: { JPY?: unknown } } | null)?.rates?.JPY;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** ドル → 円（1円未満は四捨五入） */
export function usdToYen(usd: number, rate: number): number {
  return Math.round(usd * rate);
}
