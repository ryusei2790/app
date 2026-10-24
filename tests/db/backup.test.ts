/**
 * @file tests/db/backup.test.ts
 * @description 週1の定期バックアップ（mywork#764 ②）の DB 層。ローカル Supabase だけを相手にする。
 *   weekly-backup.ts と同じ道筋（withUserDb → buildBackup → JSON → age 暗号化）で作ったファイルを、
 *   復号 → parseBackup → 別の空のユーザーへ restoreBackup で戻せ、件数が同じになることを見る。
 */

import { afterAll, describe, expect, it } from "vitest";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { adminSql, closeAdminSql, createTestUser, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import { withUserDb } from "@/lib/db";
import { buildBackup, parseBackup, restoreBackup } from "@/lib/export/full-json";
import { decryptBackup, encryptBackup } from "@/lib/backup/weekly";

const users: TestUser[] = [];

afterAll(async () => {
  const ids = users.map((u) => u.id);
  for (const t of ["receipts", "transactions", "budget_rules", "budget_frames", "fixed_costs", "csv_imports", "categories", "accounts"]) {
    await adminSql(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [ids]);
  }
  await prisma.$disconnect();
  await closeAdminSql();
});

describe("定期バックアップのファイルは restoreBackup に通る", () => {
  it("暗号化したファイルを戻して空のユーザーに復元でき、件数が同じ", async () => {
    const src = await createTestUser("backup-src");
    const dst = await createTestUser("backup-dst");
    users.push(src, dst);
    const one = async (sql: string, p: unknown[]) => (await adminSql<{ id: string }>(sql, p))[0].id;
    const account = await one("INSERT INTO accounts (user_id, name, type) VALUES ($1, '財布', 'cash') RETURNING id", [src.id]);
    const cat = await one("INSERT INTO categories (user_id, name, type) VALUES ($1, '推し活', 'expense') RETURNING id", [src.id]);
    for (const [amount, date] of [[500, "2026-10-01"], [1200, "2026-10-05"]] as const) {
      await adminSql(
        "INSERT INTO transactions (user_id, account_id, category_id, amount, type, transaction_date, note, source) VALUES ($1, $2, $3, $4, 'expense', $5, 'パン', 'manual')",
        [src.id, account, cat, amount, date]
      );
    }

    const id = await generateIdentity();
    const backup = await withUserDb(src.id, (db) => buildBackup(db, src.id));
    const file = await encryptBackup(JSON.stringify(backup), await identityToRecipient(id));

    const parsed = parseBackup(JSON.parse(await decryptBackup(file, id)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // 別ユーザーへ入れるので id は付け直さずそのまま→同じ id が既にあれば conflict。src を消してから入れる
    for (const t of ["transactions", "categories", "accounts"]) await adminSql(`DELETE FROM ${t} WHERE user_id = $1`, [src.id]);
    const counts = await withUserDb(dst.id, (db) => restoreBackup(db, dst.id, parsed.backup));
    expect(counts.transactions).toBe(2);
    const again = await withUserDb(dst.id, (db) => buildBackup(db, dst.id));
    expect(again.counts).toEqual(backup.counts);
  });
});
