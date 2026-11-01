/**
 * @file tests/unit/backup-ledger.test.ts
 * @description 一覧が取れないときの台帳と、時間制限つきの削除（mywork#1033）。
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLedger, writeLedger } from "@/lib/backup/ledger";
import { removeFileBounded } from "@/lib/backup/list-dir";

const A = "2026-10-25_kakebo-full.json.age";
const B = "2026-11-01_kakebo-full.json.age";
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ledger-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("台帳", () => {
  it("無いときは空", async () => {
    expect(await readLedger(path.join(dir, "no.txt"))).toEqual([]);
  });

  it("重複を除いて書き、読み戻せる", async () => {
    const f = path.join(dir, "sub", "written.txt");
    await writeLedger(f, [B, A, B]);
    expect(await readLedger(f)).toEqual([A, B]);
    expect(await readFile(f, "utf8")).toBe(`${A}\n${B}\n`);
  });

  it("バックアップの名前でない行は無視する", async () => {
    const f = path.join(dir, "written.txt");
    await writeFile(f, `${A}\n../../etc/passwd\nmemo\n`);
    expect(await readLedger(f)).toEqual([A]);
  });
});

describe("removeFileBounded", () => {
  it("消せる。元から無くても true", async () => {
    const f = path.join(dir, "x");
    await writeFile(f, "x");
    expect(await removeFileBounded(f)).toBe(true);
    expect(existsSync(f)).toBe(false);
    expect(await removeFileBounded(f)).toBe(true);
  });

  it("コマンドが無い・失敗は false", async () => {
    expect(await removeFileBounded("x", 1000, "/no/such")).toBe(false);
    expect(await removeFileBounded("x", 1000, "/usr/bin/false")).toBe(false);
  });

  it("時間切れは false", async () => {
    expect(await removeFileBounded("x", 50, "/bin/sleep")).toBe(false);
  });
});
