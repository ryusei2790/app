/**
 * @file tests/unit/prisma-lazy.test.ts
 * @description lib/prisma は import しただけでは DB に繋がない（P1〜P2）。
 * Vercel の Preview 環境には DATABASE_URL が無く、next build の「page data の収集」で
 * route を import した瞬間に例外が出てビルドが落ちた（2026-10-14、app#4）。
 * 接続文字列が要るのは最初に prisma を使ったとき。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const original = process.env.DATABASE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
});

describe("lib/prisma の遅延生成", () => {
  it("P1: DATABASE_URL が無くても import は失敗しない", async () => {
    delete process.env.DATABASE_URL;
    await expect(import("@/lib/prisma")).resolves.toHaveProperty("prisma");
  });

  it("P2: DATABASE_URL が無いまま使うと、理由の分かるエラーになる", async () => {
    delete process.env.DATABASE_URL;
    const { prisma } = await import("@/lib/prisma");
    expect(() => prisma.$transaction).toThrow("DATABASE_URL 環境変数が設定されていません");
  });
});
