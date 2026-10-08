-- =============================================================================
-- 20261008000000_rls_hardening.sql — RLS の締め直し（Issue #229 / テスト S1〜S5, S8）
-- 役割:
--   1. 全ポリシーを「ログイン済み（authenticated）だけ」に限定し、anon には表の権限自体を与えない（S4）
--   2. 取引・固定費・CSV 履歴の INSERT / UPDATE で、参照する口座・カテゴリ・固定費が
--      自分のもの（カテゴリは共通も可）かを DB 側でも確かめる（S3 の WITH CHECK）
--   3. 自分の分だけを月別に集計する RPC monthly_summary を追加する（S8, T3）
-- 方針: アプリ（Prisma）も withUserDb() で authenticated ロール＋auth.uid() を設定して繋ぐので、
--       ここのポリシーはブラウザからの直接アクセスとアプリの両方に効く（二重の守りの DB 側）。
-- 注意: auth.uid() は (select auth.uid()) と書く。行ごとに再評価されず、1回だけ評価されて速い。
-- =============================================================================

-- ------------------------------------------------------------
-- 1. 古いポリシーを外す（init で作った、ロール指定なし＝public 向けのもの）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_own"  ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"  ON profiles;
DROP POLICY IF EXISTS "accounts_own"         ON accounts;
DROP POLICY IF EXISTS "categories_select"    ON categories;
DROP POLICY IF EXISTS "categories_write"     ON categories;
DROP POLICY IF EXISTS "fixed_costs_own"      ON fixed_costs;
DROP POLICY IF EXISTS "csv_imports_own"      ON csv_imports;
DROP POLICY IF EXISTS "transactions_own"     ON transactions;

-- ------------------------------------------------------------
-- 2. anon（未ログイン）からは表そのものを触れなくする（RLS の前で拒否）
--    今後作る表にも効くよう、既定の権限からも外す
-- ------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- ------------------------------------------------------------
-- 3. 所有確認の部品（参照先が自分のものか）
--    SECURITY INVOKER（既定）なので、呼んだ人の RLS の下で動く。
--    → 他人の口座は RLS で見えない → EXISTS が false → 拒否、という二重の作り
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owns_account(p_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.id = p_account_id AND a.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.can_use_category(p_category_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_category_id IS NULL OR EXISTS (
    SELECT 1 FROM public.categories c
     WHERE c.id = p_category_id AND (c.user_id IS NULL OR c.user_id = (SELECT auth.uid()))
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_fixed_cost(p_fixed_cost_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_fixed_cost_id IS NULL OR EXISTS (
    SELECT 1 FROM public.fixed_costs f
     WHERE f.id = p_fixed_cost_id AND f.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_csv_import(p_csv_import_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_csv_import_id IS NULL OR EXISTS (
    SELECT 1 FROM public.csv_imports i
     WHERE i.id = p_csv_import_id AND i.user_id = (SELECT auth.uid())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.owns_account(uuid), public.can_use_category(uuid),
  public.owns_fixed_cost(uuid), public.owns_csv_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_account(uuid), public.can_use_category(uuid),
  public.owns_fixed_cost(uuid), public.owns_csv_import(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 4. 新しいポリシー（すべて TO authenticated）
-- ------------------------------------------------------------
-- profiles: 自分だけ参照・更新（作成はトリガー handle_new_user が行う）
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

-- accounts: 自分の口座だけ
CREATE POLICY "accounts_select_own" ON accounts FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "accounts_insert_own" ON accounts FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "accounts_update_own" ON accounts FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "accounts_delete_own" ON accounts FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- categories: 共通（user_id IS NULL）は読むだけ。自分の独自カテゴリは読み書き可
CREATE POLICY "categories_select" ON categories FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = (SELECT auth.uid()));
CREATE POLICY "categories_insert_own" ON categories FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND is_default = FALSE);
CREATE POLICY "categories_update_own" ON categories FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND is_default = FALSE);
CREATE POLICY "categories_delete_own" ON categories FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- fixed_costs: 自分のもの、かつ口座・カテゴリも自分のもの（カテゴリは共通も可）
CREATE POLICY "fixed_costs_select_own" ON fixed_costs FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "fixed_costs_insert_own" ON fixed_costs FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.owns_account(account_id)
    AND public.can_use_category(category_id)
  );
CREATE POLICY "fixed_costs_update_own" ON fixed_costs FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.owns_account(account_id)
    AND public.can_use_category(category_id)
  );
CREATE POLICY "fixed_costs_delete_own" ON fixed_costs FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- csv_imports: 自分のもの、かつ口座も自分のもの
CREATE POLICY "csv_imports_select_own" ON csv_imports FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "csv_imports_insert_own" ON csv_imports FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.owns_account(account_id));
CREATE POLICY "csv_imports_update_own" ON csv_imports FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.owns_account(account_id));
CREATE POLICY "csv_imports_delete_own" ON csv_imports FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- transactions: 自分のもの、かつ参照先（口座・カテゴリ・固定費・CSV 履歴）も自分のもの
CREATE POLICY "transactions_select_own" ON transactions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "transactions_insert_own" ON transactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.owns_account(account_id)
    AND public.can_use_category(category_id)
    AND public.owns_fixed_cost(fixed_cost_id)
    AND public.owns_csv_import(csv_import_id)
  );
CREATE POLICY "transactions_update_own" ON transactions FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.owns_account(account_id)
    AND public.can_use_category(category_id)
    AND public.owns_fixed_cost(fixed_cost_id)
    AND public.owns_csv_import(csv_import_id)
  );
CREATE POLICY "transactions_delete_own" ON transactions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ------------------------------------------------------------
-- 5. 月別集計 RPC（S8・T3）
--    SECURITY INVOKER（既定）＝呼んだ人の RLS の下で動く。さらに user_id = auth.uid() でも絞る。
--    月の範囲は日付（date 列）で [当月1日, 翌月1日) とし、サーバーの TZ に左右されない。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.monthly_summary(p_year integer, p_month integer)
RETURNS TABLE (type text, category_id uuid, total numeric)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT t.type, t.category_id, SUM(t.amount) AS total
    FROM public.transactions t
   WHERE t.user_id = (SELECT auth.uid())
     AND t.deleted_at IS NULL
     AND t.transaction_date >= make_date(p_year, p_month, 1)
     AND t.transaction_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
   GROUP BY t.type, t.category_id;
$$;

REVOKE EXECUTE ON FUNCTION public.monthly_summary(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monthly_summary(integer, integer) TO authenticated;
