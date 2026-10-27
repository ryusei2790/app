/**
 * @file scripts/backup/weekly-backup.ts
 * @description 週1の定期バックアップ本体（mywork#764 ②）。launchd（com.ryusei.kakebo-backup）から run.sh 経由で呼ばれる。
 *   1. 本番 DB に繋ぎ、本人のユーザー ID で withUserDb（RLS）→ buildBackup で完全形式 JSON を作る（画面の書き出しと同じ中身）
 *   2. age で暗号化して BACKUP_DIR（Google Drive の 家計簿バックアップ/）に置く
 *   3. 古いファイルを間引く（直近8本＋月初12か月）
 * DB は読むだけ。出力は件数とファイル名だけ（金額・メモは出さない、S11）。
 *
 * 環境変数: DATABASE_URL（run.sh がキーチェーンから組み立てる）・AGE_RECIPIENT（age1…）・BACKUP_DIR・OWNER_ID（省略時は auth.users がちょうど1人ならその人）
 */

import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { withUserDb, isUuid } from "@/lib/db";
import { buildBackup } from "@/lib/export/full-json";
import { backupFileName, encryptBackup, selectToDelete } from "@/lib/backup/weekly";
import { todayJst } from "@/lib/date/jst";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} がありません`);
  return v;
}

/** 本人の ID。家計簿は本人だけが使うので、指定が無ければ auth.users の1人を使う（2人以上なら止める） */
async function ownerId(): Promise<string> {
  if (process.env.OWNER_ID) {
    if (!isUuid(process.env.OWNER_ID)) throw new Error("OWNER_ID が UUID ではありません");
    return process.env.OWNER_ID;
  }
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM auth.users`;
  if (rows.length !== 1) throw new Error(`auth.users が ${rows.length} 人なので OWNER_ID を指定してください`);
  return rows[0].id;
}

async function main() {
  const recipient = need("AGE_RECIPIENT");
  const dir = need("BACKUP_DIR");
  const now = new Date();
  const userId = await ownerId();

  const backup = await withUserDb(userId, (db) => buildBackup(db, userId, now));
  const data = await encryptBackup(JSON.stringify(backup), recipient);

  // 書きかけのファイルが Drive に同期されないよう、別名で書いてから名前を変える
  await mkdir(dir, { recursive: true });
  const name = backupFileName(now);
  const tmp = path.join(dir, `.${name}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, path.join(dir, name));

  // launchd から起動した node は Drive フォルダの一覧を TCC に拒まれる（書き込みは通る。mywork#839）。
  // 一覧が取れないときは古いファイルの整理だけ飛ばし、バックアップ自体は成功扱いにする
  const names = await readdir(dir).catch((e) => {
    if (e?.code === "EPERM" || e?.code === "EACCES") return null;
    throw e;
  });
  const remove = names ? selectToDelete(names, todayJst(now)) : [];
  for (const f of remove) await unlink(path.join(dir, f));

  console.log(JSON.stringify({ ok: true, file: name, counts: backup.counts, deleted: remove, ...(names ? {} : { rotate: "skipped (no list permission)" }) }));
}

main()
  .catch((e) => {
    // エラーの文に接続文字列が入ることがあるので、種類と先頭だけ出す
    console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "<db>").slice(0, 300) }));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
