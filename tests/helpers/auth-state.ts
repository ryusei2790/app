/**
 * @file tests/helpers/auth-state.ts
 * @description API テストで「いま誰がログインしているか」を差し替えるための状態。
 * route handler は @/lib/supabase/server の auth.getUser() でユーザーを得るので、
 * そのモジュールをモック（supabase-server-mock.ts）にして、ここの値を返させる。
 * JWT の検証そのものは Supabase の責務なので、API テストでは「検証済みのユーザーが誰か」だけを差し替える。
 */

export interface MockAuthUser {
  id: string;
  email: string;
}

let current: MockAuthUser | null = null;

export function signInAs(user: MockAuthUser | null) {
  current = user;
}

export function currentUser(): MockAuthUser | null {
  return current;
}
