/**
 * @file lib/backup/weekly.ts
 * @description 週1の定期バックアップ（mywork#764 ②、設計書 kakebo_next/docs/2026-10-24_定期バックアップ_設計.md）の純粋な部品。
 *   - ファイル名: `YYYY-MM-DD_kakebo-full.json.age`（日付は JST）
 *   - 暗号化・復号: age（age-encryption。age CLI と同じ形式なので `age -d -i 鍵` でも戻せる）
 *   - 間引き: 直近8本＋月初（その月で一番古い1本）を12か月分残し、ほかは消す
 * 中身（金額・メモ）はここでは扱わない。ログにも出さない（S11）。
 */

import { Decrypter, Encrypter } from "age-encryption";
import { todayJst } from "@/lib/date/jst";

export const BACKUP_SUFFIX = "_kakebo-full.json.age";
export const KEEP_RECENT = 8;
export const KEEP_MONTHS = 12;

const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})_kakebo-full\.json\.age$/;

/** その日のバックアップのファイル名（JST の日付） */
export function backupFileName(now: Date): string {
  return `${todayJst(now)}${BACKUP_SUFFIX}`;
}

/** ファイル名から日付（YYYY-MM-DD）を取る。バックアップでなければ null（間引きで触らない） */
export function backupDateOf(name: string): string | null {
  const m = NAME_RE.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * 消すファイルを選ぶ。バックアップの名前でないものは選ばない。
 * 残す: 新しい順に KEEP_RECENT 本 ＋ today の月から数えて KEEP_MONTHS か月の各月の一番古い1本
 */
export function selectToDelete(names: string[], today: string): string[] {
  const dated = names
    .map((name) => ({ name, date: backupDateOf(name) }))
    .filter((f): f is { name: string; date: string } => f.date !== null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const keep = new Set(dated.slice(0, KEEP_RECENT).map((f) => f.name));

  const [y, m] = today.split("-").map(Number);
  const months = new Set<string>();
  for (let i = 0; i < KEEP_MONTHS; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const firstOfMonth = new Map<string, string>();
  for (const f of [...dated].reverse()) {
    const ym = f.date.slice(0, 7);
    if (months.has(ym) && !firstOfMonth.has(ym)) firstOfMonth.set(ym, f.name);
  }
  for (const name of firstOfMonth.values()) keep.add(name);

  return dated.filter((f) => !keep.has(f.name)).map((f) => f.name);
}

/** JSON の文字列を age の公開鍵（age1…）で暗号化する */
export async function encryptBackup(json: string, recipient: string): Promise<Uint8Array> {
  const e = new Encrypter();
  e.addRecipient(recipient);
  return e.encrypt(json);
}

/** age の秘密鍵（AGE-SECRET-KEY-1…）で戻す */
export async function decryptBackup(data: Uint8Array, identity: string): Promise<string> {
  const d = new Decrypter();
  d.addIdentity(identity);
  return d.decrypt(data, "text");
}
