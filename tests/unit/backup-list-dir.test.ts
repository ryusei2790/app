/** listDirBounded: 止まる一覧でもバックアップを道連れにしない（mywork#1031） */
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listDirBounded } from "@/lib/backup/list-dir";

const dir = mkdtempSync(path.join(tmpdir(), "list-dir-"));
writeFileSync(path.join(dir, "a.age"), "");
writeFileSync(path.join(dir, ".hidden"), "");

describe("listDirBounded", () => {
  it("名前を返す", async () => {
    expect((await listDirBounded(dir))?.sort()).toEqual([".hidden", "a.age"]);
  });
  it("無いフォルダは null", async () => {
    expect(await listDirBounded(path.join(dir, "none"))).toBeNull();
  });
  it("コマンドが無ければ null", async () => {
    expect(await listDirBounded(dir, 1000, "/no/such/command")).toBeNull();
  });
  it("返らないコマンドは時間切れで null", async () => {
    const hang = path.join(dir, "hang.sh");
    writeFileSync(hang, "#!/bin/bash\nsleep 30\n");
    chmodSync(hang, 0o755);
    const t = Date.now();
    expect(await listDirBounded(dir, 200, hang)).toBeNull();
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
