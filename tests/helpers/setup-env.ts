/**
 * @file tests/helpers/setup-env.ts
 * @description db プロジェクトの各テストファイルの前に走る。
 * global-setup が渡したローカル Supabase の値を process.env に入れる。
 * アプリのコード（src/lib/prisma.ts など）は process.env から読むので、
 * ここで上書きしておけばテスト中は必ずローカル DB に向く。
 */

import { inject } from "vitest";

const env = inject("supabase");
process.env.DATABASE_URL = env.dbUrl;
process.env.NEXT_PUBLIC_SUPABASE_URL = env.apiUrl;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
// 社長アカウント判定はテストごとに明示的に設定する（既定は「誰も社長でない」）
delete process.env.OWNER_USER_IDS;
