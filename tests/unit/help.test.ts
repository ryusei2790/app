/**
 * @file tests/unit/help.test.ts
 * @description 使い方（mywork#764 ①）。H1 画面の「？」の行き先の節が全部ある・H2 節のリンク先の画面が実在・H3 メニューから開ける
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_PATH, HELP_SECTIONS } from "@/lib/help/sections";
import { CATALOG } from "@/lib/menu/catalog";

const src = path.resolve(__dirname, "../../src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : [],
  );
}

describe("使い方", () => {
  it("H1 画面の「？」の section は全部 HELP_SECTIONS にある", () => {
    const ids = new Set(HELP_SECTIONS.map((s) => s.id));
    const used = files(path.join(src, "components")).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/<HelpLink section="([^"]+)"/g)].map((m) => m[1]),
    );
    expect(used.length).toBeGreaterThanOrEqual(5);
    for (const id of used) expect(ids.has(id), id).toBe(true);
  });

  it("H2 節の「画面を開く」の先が実在する", () => {
    for (const s of HELP_SECTIONS.filter((s) => s.href)) {
      expect(existsSync(path.join(src, "app", "(dashboard)", s.href!, "page.tsx")), s.href).toBe(true);
    }
    expect(existsSync(path.join(src, "app", HELP_PATH, "page.tsx"))).toBe(true);
  });

  it("H3 機能カタログに使い方がある", () => {
    expect(CATALOG.find((f) => f.href === HELP_PATH)).toBeTruthy();
  });
});
