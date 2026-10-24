/**
 * @file tests/unit/backup.test.ts
 * @description 週1の定期バックアップ（mywork#764 ②）の部品。暗号化→復号で同じ・ファイル名・間引き。
 * DB を通した「作ったファイルが restoreBackup に通る」は tests/db/backup.test.ts。
 */

import { describe, expect, it } from "vitest";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { backupDateOf, backupFileName, decryptBackup, encryptBackup, selectToDelete } from "@/lib/backup/weekly";

describe("暗号化", () => {
  it("暗号化→復号で同じ文字列に戻る。暗号文に元の文字列は含まれない", async () => {
    const id = await generateIdentity();
    const json = JSON.stringify({ format: "kakebo-full", memo: "家賃 85000 円" });
    const enc = await encryptBackup(json, await identityToRecipient(id));
    expect(Buffer.from(enc).toString("latin1")).not.toContain("85000");
    expect(await decryptBackup(enc, id)).toBe(json);
  });

  it("違う鍵では戻せない", async () => {
    const enc = await encryptBackup("{}", await identityToRecipient(await generateIdentity()));
    await expect(decryptBackup(enc, await generateIdentity())).rejects.toThrow();
  });
});

describe("ファイル名", () => {
  it("JST の日付で付ける（UTC の前日 15:30 は JST の翌日）", () => {
    expect(backupFileName(new Date("2026-10-24T15:30:00Z"))).toBe("2026-10-25_kakebo-full.json.age");
    expect(backupDateOf("2026-10-25_kakebo-full.json.age")).toBe("2026-10-25");
    expect(backupDateOf("メモ.txt")).toBeNull();
  });
});

/** 2025-01-05 から毎週日曜の名前を n 本 */
function weekly(n: number): string[] {
  return Array.from({ length: n }, (_, i) => backupFileName(new Date(Date.UTC(2025, 0, 5 + 7 * i, 3))));
}

describe("間引き", () => {
  it("8本以下なら何も消さない", () => {
    expect(selectToDelete(weekly(8), "2025-02-23")).toEqual([]);
  });

  it("直近8本＋12か月の各月の一番古い1本を残す", () => {
    const names = weekly(100); // 2025-01-05〜2026-11-29
    const today = "2026-11-29";
    const del = new Set(selectToDelete(names, today));
    const kept = names.filter((n) => !del.has(n));
    // 直近8本
    for (const n of names.slice(-8)) expect(kept).toContain(n);
    // 2025-12〜2026-11 の各月の最初の日曜
    for (const d of ["2025-12-07", "2026-01-04", "2026-02-01", "2026-03-01", "2026-06-07", "2026-10-04"]) {
      expect(kept).toContain(`${d}_kakebo-full.json.age`);
    }
    // 12か月より前の月初は消す
    expect(del.has("2025-11-02_kakebo-full.json.age")).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(8 + 12);
  });

  it("バックアップの名前でないファイルには触らない", () => {
    expect(selectToDelete([...weekly(30), "README.txt", ".x.tmp"], "2025-07-27")).not.toContain("README.txt");
  });
});
