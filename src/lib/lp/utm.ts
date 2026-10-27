/**
 * @file lib/lp/utm.ts
 * @description 広告の UTM の取り出し・検証と、着地ページの cookie の名前（mywork#878）。
 * 値は 100 文字まで・英数と `_-.` だけを残す（それ以外は捨てる）。空になったものは無かったことにする。
 */

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;

/** 最初に来た広告の UTM（JSON、30日。上書きしない） */
export const UTM_COOKIE = "kb_utm";
/** 同じ人の再訪を数え分けるためのランダムな ID（30日） */
export const VISITOR_COOKIE = "kb_vid";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const MAX_LEN = 100;

/** 1つの値を検証する。使えない文字は捨て、空なら undefined */
export function cleanUtmValue(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, MAX_LEN);
  return s === "" ? undefined : s;
}

/** URLSearchParams か普通のオブジェクトから UTM 4つを取り出す */
export function pickUtm(src: URLSearchParams | Record<string, unknown> | null | undefined): Utm {
  const out: Utm = {};
  if (!src) return out;
  for (const k of UTM_KEYS) {
    const raw = src instanceof URLSearchParams ? src.get(k) : src[k];
    const v = cleanUtmValue(Array.isArray(raw) ? raw[0] : raw);
    if (v) out[k] = v;
  }
  return out;
}

export function hasUtm(u: Utm): boolean {
  return UTM_KEYS.some((k) => u[k]);
}

/** cookie の JSON を読む。壊れていれば空 */
export function parseUtmCookie(raw: string | undefined): Utm {
  if (!raw) return {};
  try {
    return pickUtm(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** cookie に書く値を決める。既に UTM があれば上書きしない（最初に来た広告を正とする）。書かないときは null */
export function nextUtmCookie(existing: Utm, incoming: Utm): string | null {
  if (hasUtm(existing) || !hasUtm(incoming)) return null;
  return JSON.stringify(incoming);
}

/** visitor_id として受け取ってよい形か（自分で発行した UUID だけ） */
export function isVisitorId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const BOT_UA = /bot|crawler|spider|crawling|facebookexternalhit|preview|headless|lighthouse/i;
/** ボット・リンクのプレビュー取得は数えない */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !ua || BOT_UA.test(ua);
}

/** referrer はホスト名だけ残す（パス・クエリは捨てる） */
export function referrerHost(ref: string | null | undefined): string | undefined {
  if (!ref) return undefined;
  try {
    return new URL(ref).hostname.slice(0, MAX_LEN) || undefined;
  } catch {
    return undefined;
  }
}

/** 事前登録のメールアドレスを検証して小文字にする。だめなら null */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

/** CSV の1セル。数式として解釈される先頭文字は ' で無効化する */
export function csvCell(v: string | null | undefined): string {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
