/**
 * @file tests/unit/data-flow.test.ts
 * @description テスト一覧 S13（mywork#425 第1弾）。
 * 「何が外に出るか」の表（lib/aggregate/definitions.ts の DATA_FLOW）が実コードと食い違わないよう、
 * src/ の文字列リテラルにある https:// の送信先ホストを機械的に集め、表に書いてあるホストだけであることを確かめる。
 * 表に無いホストへ送るコードを足すと、ここが落ちて表の更新を促す（表が古くなるのを防ぐ）。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_FLOW } from "@/lib/aggregate/definitions";

const srcDir = path.resolve(__dirname, "../../src");

/** 画面にリンクを置くだけで、家計簿のデータを何も送らないホスト（規約・プライバシーの問い合わせ先。mywork#878） */
const LINK_ONLY_HOSTS = new Set(["frural.jp"]);

/** 文字列リテラルの中の https:// のホスト名だけを拾う（コメントの URL は対象にしない） */
const LITERAL_URL = /["'`]https?:\/\/([a-z0-9.-]+)[^"'`]*["'`]/gi;

function sourceFiles(): string[] {
  return readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("generated"))
    .map((f) => path.join(srcDir, f));
}

describe("S13 外部の送信先はすべて「何が外に出るか」の表にある", () => {
  it("コードの https:// のホストが DATA_FLOW のホストに含まれる", () => {
    const declared = new Set(DATA_FLOW.flatMap((r) => r.hosts));
    const found = new Map<string, string[]>();
    for (const file of sourceFiles()) {
      const body = readFileSync(file, "utf8");
      for (const m of body.matchAll(LITERAL_URL)) {
        const host = m[1].toLowerCase();
        found.set(host, [...(found.get(host) ?? []), path.relative(srcDir, file)]);
      }
    }
    // 少なくともレシート読み取りの送信先は見つかる（テスト自体が空振りしていないことの確認）
    expect([...found.keys()]).toContain("openrouter.ai");
    for (const [host, files] of found) {
      if (LINK_ONLY_HOSTS.has(host)) continue;
      expect(declared.has(host), `${host}（${files.join(", ")}）が DATA_FLOW にありません`).toBe(true);
    }
  });

  it("表の各行に 操作・出るもの・経由・保存先 がある", () => {
    for (const row of DATA_FLOW) {
      expect(row.operation.length).toBeGreaterThan(0);
      expect(row.leaves.length).toBeGreaterThan(0);
      expect(row.via.length).toBeGreaterThan(0);
      expect(row.storedAt.length).toBeGreaterThan(0);
    }
    // AI 提供元のホストは表に明記されている
    const hosts = new Set(DATA_FLOW.flatMap((r) => r.hosts));
    expect(hosts).toContain("openrouter.ai");
    expect(hosts).toContain("api.anthropic.com");
  });
});
