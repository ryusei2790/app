/**
 * @file tests/helpers/global-setup.ts
 * @description db プロジェクトの最初に1回だけ走る準備。
 * `supabase status -o json` からローカル Supabase の URL・既定キー・DB 接続文字列を取り、
 * provide() で各テストファイルへ渡す（.env / .env.local は読まない）。
 * 接続先が 127.0.0.1 / localhost でなければ即中断する（クラウドの DB を絶対に触らない）。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import type { TestProject } from "vitest/node";

export interface LocalSupabaseEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    supabase: LocalSupabaseEnv;
  }
}

function isLocalUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

export default function setup(project: TestProject) {
  let raw: string;
  try {
    raw = execFileSync("supabase", ["status", "-o", "json"], {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "ローカルの Supabase が起動していません。`supabase start` を実行してから `npm run test:db` を回してください。"
    );
  }
  // CLI が JSON の前後に案内文を出すことがあるので、最初の { から最後の } までを読む
  const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  const env: LocalSupabaseEnv = {
    apiUrl: json.API_URL,
    anonKey: json.ANON_KEY,
    serviceRoleKey: json.SERVICE_ROLE_KEY,
    dbUrl: json.DB_URL,
  };
  for (const [k, v] of Object.entries(env)) {
    if (!v) throw new Error(`supabase status に ${k} がありません`);
  }
  if (!isLocalUrl(env.apiUrl) || !isLocalUrl(env.dbUrl)) {
    throw new Error("ローカル以外の Supabase には繋ぎません（安全装置）");
  }
  project.provide("supabase", env);
}
