/**
 * @file tests/helpers/supabase-server-mock.ts
 * @description @/lib/supabase/server の代わり。auth.getUser() が auth-state の値を返す。
 * 使い方（テストファイルの先頭）:
 *   vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));
 */

import { currentUser } from "./auth-state";

export async function createClient() {
  return {
    auth: {
      async getUser() {
        const u = currentUser();
        return u
          ? { data: { user: { id: u.id, email: u.email } }, error: null }
          : { data: { user: null }, error: { message: "not signed in" } };
      },
    },
  };
}
