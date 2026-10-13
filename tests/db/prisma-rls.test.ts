/**
 * @file tests/db/prisma-rls.test.ts
 * @description 既知の弱点「Prisma が管理者権限で繋ぐので RLS が効かない」への対策を確かめる。
 * アプリは DB に触るとき必ず withUserDb(userId, fn) を通す。その中では
 * ロールが authenticated・auth.uid() がそのユーザーになり、RLS がアプリの経路にも効く。
 * → コードで where: { userId } を書き忘れても、他人の行は見えない・書けない（二重の守り）。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminSql,
  closeAdminSql,
  createTestUser,
  seedAccount,
  seedTransaction,
  type TestUser,
} from "../helpers/local-supabase";
import { withUserDb } from "@/lib/db";
import { prisma } from "@/lib/prisma";

let A: TestUser;
let B: TestUser;
let aTx: string;
let aAccount: string;
let bAccount: string;

beforeAll(async () => {
  A = await createTestUser("pa");
  B = await createTestUser("pb");
  aAccount = await seedAccount(A.id);
  bAccount = await seedAccount(B.id);
  aTx = await seedTransaction(A.id, aAccount, { amount: 7777 });
  await seedTransaction(B.id, bAccount, { amount: 10 });
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeAdminSql();
});

describe("S1/S2 アプリの DB 接続（Prisma）でも RLS が効く", () => {
  it("userId で絞り忘れた findMany でも、B には B の取引しか返らない", async () => {
    const rows = await withUserDb(B.id, (db) => db.transaction.findMany());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.userId === B.id)).toBe(true);
    expect(rows.find((r) => r.id === aTx)).toBeUndefined();
  });

  it("絞り忘れた updateMany / deleteMany でも A の行は0件しか変わらない", async () => {
    const upd = await withUserDb(B.id, (db) =>
      db.transaction.updateMany({ where: { id: aTx }, data: { note: "乗っ取り" } })
    );
    expect(upd.count).toBe(0);
    const del = await withUserDb(B.id, (db) => db.transaction.deleteMany({ where: { id: aTx } }));
    expect(del.count).toBe(0);
    const rows = await adminSql<{ note: string | null }>("SELECT note FROM transactions WHERE id=$1", [aTx]);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBeNull();
  });

  it("B が A の口座を指す取引を作ろうとすると DB が拒否する", async () => {
    await expect(
      withUserDb(B.id, (db) =>
        db.transaction.create({
          data: {
            userId: B.id, accountId: aAccount, amount: 1, type: "expense",
            transactionDate: new Date("2026-10-01T00:00:00Z"), source: "manual",
          },
        })
      )
    ).rejects.toThrow();
  });

  it("withUserDb の中では auth.uid() が渡したユーザーになり、外に漏れない", async () => {
    const uid = await withUserDb(B.id, async (db) => {
      const r = await db.$queryRaw<{ uid: string }[]>`SELECT auth.uid()::text AS uid`;
      return r[0].uid;
    });
    expect(uid).toBe(B.id);
    // トランザクションを抜けた後の素の接続には設定が残らない（SET LOCAL）
    const after = await prisma.$queryRaw<{ uid: string | null }[]>`SELECT auth.uid()::text AS uid`;
    expect(after[0].uid).toBeNull();
  });

  it("userId が UUID でなければ DB に触る前に拒否する", async () => {
    await expect(withUserDb("' OR 1=1 --", (db) => db.transaction.findMany())).rejects.toThrow();
  });
});
