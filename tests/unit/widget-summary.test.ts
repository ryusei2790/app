/**
 * @file tests/unit/widget-summary.test.ts
 * @description ウィジェット用 API（mywork#967）。トークンなし・違うトークン・未設定は 401、正しいトークンで今月の収入・支出・合計だけを返す。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  withUserDb: vi.fn(async (_id: string, fn: (db: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/aggregate/load", () => ({
  loadMonthlySummary: vi.fn(async () => ({
    summary: { income: { total: 300, count: 1 }, expense: { total: 120 }, balance: 180, byCategory: [{ name: "食費" }] },
    upcoming: [],
  })),
}));
vi.mock("@/lib/date/jst", () => ({ todayJst: () => "2026-10-30" }));

import { widgetAuthorized, widgetSummaryGet } from "@/app/api/v1/widget/summary/handler";
import { loadMonthlySummary } from "@/lib/aggregate/load";
import { withUserDb } from "@/lib/db";

const req = (auth?: string) =>
  new Request("http://localhost/api/v1/widget/summary", { headers: auth ? { authorization: auth } : {} });

describe("widgetAuthorized", () => {
  const env = { WIDGET_TOKEN: "secret-token", WIDGET_USER_ID: "u1" } as unknown as NodeJS.ProcessEnv;
  it("正しい Bearer だけ通す", () => {
    expect(widgetAuthorized("Bearer secret-token", env)).toBe(true);
    expect(widgetAuthorized("Bearer secret-tokem", env)).toBe(false);
    expect(widgetAuthorized("secret-token", env)).toBe(false);
    expect(widgetAuthorized(null, env)).toBe(false);
  });
  it("トークンかユーザー ID が未設定なら常に拒否", () => {
    expect(widgetAuthorized("Bearer ", { WIDGET_USER_ID: "u1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(widgetAuthorized("Bearer secret-token", { WIDGET_TOKEN: "secret-token" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("GET /api/v1/widget/summary", () => {
  beforeEach(() => {
    vi.stubEnv("WIDGET_TOKEN", "secret-token");
    vi.stubEnv("WIDGET_USER_ID", "u1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("トークンなしは 401 で DB に触らない", async () => {
    const res = await widgetSummaryGet(req());
    expect(res.status).toBe(401);
    expect(withUserDb).not.toHaveBeenCalled();
  });

  it("違うトークンは 401", async () => {
    expect((await widgetSummaryGet(req("Bearer nope"))).status).toBe(401);
  });

  it("正しいトークンで今月の収入・支出・合計だけを返す（キャッシュさせない）", async () => {
    const res = await widgetSummaryGet(req("Bearer secret-token"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      data: { month: "2026-10", today: "2026-10-30", income: 300, expense: 120, balance: 180 },
    });
    expect(withUserDb).toHaveBeenCalledWith("u1", expect.any(Function));
    expect(loadMonthlySummary).toHaveBeenCalledWith({}, "u1", "2026-10", { today: "2026-10-30", owner: false });
  });
});
