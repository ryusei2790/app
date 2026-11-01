/**
 * @file lib/backup/ledger.ts
 * @description 定期バックアップで書いたファイル名の台帳（mywork#1033）。
 *   launchd からは Drive の一覧だけが取れない（書く・消すはできる）。bash や node にフルディスクアクセスを与えると
 *   DATABASE_URL を持つ処理の権限が広がるので、一覧の代わりに手元の台帳（Mac のローカル）で古いファイルを選ぶ。
 *   中身はファイル名だけ。バックアップの名前でない行は無視する（間引きで余計なものを消さないため）。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { backupDateOf } from "@/lib/backup/weekly";

/** 台帳を読む。無いときは空 */
export async function readLedger(file: string): Promise<string[]> {
  const text = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  return text.split("\n").filter((l) => backupDateOf(l) !== null);
}

/** 台帳を書き直す。途中で落ちても壊れないよう別名に書いてから置き換える */
export async function writeLedger(file: string, names: string[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const unique = [...new Set(names)].sort();
  const tmp = `${file}.tmp`;
  await writeFile(tmp, unique.map((n) => `${n}\n`).join(""));
  await rename(tmp, file);
}
