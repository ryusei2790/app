/**
 * @file tests/unit/features.test.ts
 * @description S6（社長専用機能の判定）の単体テスト。DB 不要。
 * 社長かどうかは環境変数 OWNER_USER_IDS（Supabase のユーザー ID、カンマ区切り）だけで決める。
 */

import { describe, expect, it } from "vitest";
import { isOwner, parseOwnerIds } from "@/lib/features";
import { navItemsFor } from "@/lib/nav";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("S6 社長アカウントの判定", () => {
  it("OWNER_USER_IDS に入っている ID だけが社長", () => {
    const env = { OWNER_USER_IDS: `${OWNER}` };
    expect(isOwner({ id: OWNER }, env)).toBe(true);
    expect(isOwner({ id: OTHER }, env)).toBe(false);
  });

  it("カンマ区切り・前後の空白を許す", () => {
    expect(parseOwnerIds(` ${OWNER} , ${OTHER} ,`)).toEqual([OWNER, OTHER]);
    expect(isOwner({ id: OTHER }, { OWNER_USER_IDS: ` ${OWNER} , ${OTHER} ` })).toBe(true);
  });

  it("未設定・空・未ログインなら誰も社長でない（閉じる側に倒す）", () => {
    expect(isOwner({ id: OWNER }, {})).toBe(false);
    expect(isOwner({ id: OWNER }, { OWNER_USER_IDS: "" })).toBe(false);
    expect(isOwner({ id: OWNER }, { OWNER_USER_IDS: " , " })).toBe(false);
    expect(isOwner(null, { OWNER_USER_IDS: OWNER })).toBe(false);
    expect(isOwner({ id: "" }, { OWNER_USER_IDS: OWNER })).toBe(false);
  });

  it("メールアドレスでは判定しない（なりすまし登録で社長扱いにならない）", () => {
    expect(isOwner({ id: OTHER, email: "owner@example.com" }, { OWNER_USER_IDS: OWNER })).toBe(false);
  });

  it("メニューの予算台帳は社長にだけ出る", () => {
    const hrefs = (owner: boolean) => navItemsFor({ isOwner: owner }).map((i) => i.href);
    expect(hrefs(false)).not.toContain("/budget");
    expect(hrefs(true)).toContain("/budget");
    expect(hrefs(false)).toContain("/calendar");
  });
});
