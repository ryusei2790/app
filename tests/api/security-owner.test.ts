/**
 * @file tests/api/security-owner.test.ts
 * @description S6: 予算台帳（社長専用）の API と画面を一般ユーザーに出さない。
 * 社長かどうかは環境変数 OWNER_USER_IDS で決める（値はコードに書かない。テストでは都度設定）。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { signInAs } from "../helpers/auth-state";
import { getRequest } from "../helpers/api";
import { closeAdminSql, createTestUser, type TestUser } from "../helpers/local-supabase";
import * as budget from "@/app/api/v1/budget/route";
import BudgetPage from "@/app/(dashboard)/budget/page";

let A: TestUser;
let B: TestUser;
const asA = () => signInAs({ id: A.id, email: A.email });
const asB = () => signInAs({ id: B.id, email: B.email });

beforeAll(async () => {
  A = await createTestUser("owner");
  B = await createTestUser("general");
});

afterEach(() => {
  signInAs(null);
  delete process.env.OWNER_USER_IDS;
});

afterAll(async () => {
  await closeAdminSql();
});

describe("S6 予算台帳（社長専用）は一般ユーザーに出さない", () => {
  it("未ログインで予算台帳 API を呼ぶと 401", async () => {
    process.env.OWNER_USER_IDS = A.id;
    expect((await budget.GET(getRequest("/api/v1/budget"))).status).toBe(401);
  });

  it("一般ユーザーが予算台帳 API を呼ぶと 403", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asB();
    expect((await budget.GET(getRequest("/api/v1/budget"))).status).toBe(403);
  });

  it("社長アカウント（OWNER_USER_IDS に入っている）なら 200", async () => {
    process.env.OWNER_USER_IDS = `${A.id}`;
    asA();
    expect((await budget.GET(getRequest("/api/v1/budget"))).status).toBe(200);
  });

  it("OWNER_USER_IDS が未設定なら誰も使えない（設定漏れで開かない）", async () => {
    asA();
    expect((await budget.GET(getRequest("/api/v1/budget"))).status).toBe(403);
  });

  it("一般ユーザーが予算台帳の画面を開くと 404（存在を見せない）", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asB();
    await expect(BudgetPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("社長アカウントなら画面が描ける", async () => {
    process.env.OWNER_USER_IDS = A.id;
    asA();
    await expect(BudgetPage()).resolves.toBeTruthy();
  });
});

