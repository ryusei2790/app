/**
 * @file lib/backup/list-dir.ts
 * @description 定期バックアップの古いファイル整理で使う、時間制限つきのフォルダ一覧（mywork#1031）。
 *   launchd から起動した処理が Drive フォルダを開くと、TCC に拒まれる（#839）だけでなく、open(2) が返らず永久に止まることがある。
 *   node の readdir はスレッドプールの中で止まり、タイムアウトも process.exit も効かないので、別プロセスの ls に任せて時間が来たら切り捨てる。
 */

import { spawn } from "node:child_process";

/** 一覧を待つ上限。Drive が普通に応答すれば数秒で返る */
export const LIST_TIMEOUT_MS = 30_000;

/** dir の中の名前を返す。失敗・拒否・時間切れは null（整理を飛ばす合図）で、例外にはしない */
export function listDirBounded(dir: string, timeoutMs = LIST_TIMEOUT_MS, command = "/bin/ls"): Promise<string[] | null> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-1A", dir], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const finish = (v: string[] | null) => {
      clearTimeout(timer);
      resolve(v);
    };
    // kill が効かなくても待たずに null を返す。残った子が親の終了を止めないよう unref する
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.unref();
      finish(null);
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? out.split("\n").filter(Boolean) : null));
  });
}
