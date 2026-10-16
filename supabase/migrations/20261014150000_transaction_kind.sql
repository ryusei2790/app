-- =============================================================================
-- 20261014150000_transaction_kind.sql — 取引の「種類」と集計の定義（mywork#425 第1弾 / テスト一覧 D1・V3）
--
-- 1. transactions.kind … 取引の種類。お金の向き（type: income/expense）とは別に持つ
--      normal   … 購入（expense）／収入（income）。既定。既存の行はすべて normal で数字は変わらない（D1）
--      refund   … 返金（支出の戻り）。向きは income だけ（CHECK）。支出＝購入−返金 で引く
--      transfer … 振替（チャージ・引き出し・立替の精算）。支出にも収入にも入れない
--      loan     … 借入（income）／返済（expense）。支出にも収入にも入れない
--    判定の結果は列に持つが、集計はアプリの lib/aggregate（TS）が定義どおりに行う
-- 2. monthly_summary … 既存の RPC を kind ごとの合計に（返す列に kind と件数を足す。呼び方は同じ）
-- 3. monthly_totals  … 定義（4-1）を SQL でも書いたもの。TS の集計と同じ数字になるかの照合（V3）にだけ使う
--    どちらも SECURITY INVOKER（呼んだ人の RLS の下で動く）＋ user_id = auth.uid() で絞る
-- =============================================================================

-- ------------------------------------------------------------
-- 1. 種類の列
-- ------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal'
  CHECK (kind IN ('normal', 'refund', 'transfer', 'loan'));

-- 返金は「戻ってきたお金」なので収入の向きだけ（支出の返金という組み合わせは作らない）
ALTER TABLE transactions
  ADD CONSTRAINT transactions_refund_is_income CHECK (kind <> 'refund' OR type = 'income');

-- ------------------------------------------------------------
-- 2. 月別集計 RPC を kind 対応に（返す列が変わるので作り直す）
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.monthly_summary(integer, integer);

CREATE FUNCTION public.monthly_summary(p_year integer, p_month integer)
RETURNS TABLE (type text, kind text, category_id uuid, total numeric, count bigint)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT t.type, t.kind, t.category_id, SUM(t.amount) AS total, COUNT(*) AS count
    FROM public.transactions t
   WHERE t.user_id = (SELECT auth.uid())
     AND t.deleted_at IS NULL
     AND t.transaction_date >= make_date(p_year, p_month, 1)
     AND t.transaction_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
   GROUP BY t.type, t.kind, t.category_id;
$$;

REVOKE EXECUTE ON FUNCTION public.monthly_summary(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monthly_summary(integer, integer) TO authenticated;

-- ------------------------------------------------------------
-- 3. 定義どおりの月の数字（照合用）
--    p_today … JST の今日。これより後の日付は「予定」（今月は今日まで。過去の月は全部実績、先の月は全部予定）
-- ------------------------------------------------------------
CREATE FUNCTION public.monthly_totals(p_year integer, p_month integer, p_today date)
RETURNS TABLE (
  purchases numeric, refunds numeric, expense numeric, income numeric,
  transfers_out numeric, transfers_in numeric, loans_repaid numeric, loans_borrowed numeric,
  scheduled_expense numeric, scheduled_income numeric
)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH t AS (
    SELECT tr.type, tr.kind, tr.amount, (tr.transaction_date > p_today) AS scheduled
      FROM public.transactions tr
     WHERE tr.user_id = (SELECT auth.uid())
       AND tr.deleted_at IS NULL
       AND tr.transaction_date >= make_date(p_year, p_month, 1)
       AND tr.transaction_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
  )
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'expense' AND kind = 'normal'), 0) AS purchases,
    COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'income'  AND kind = 'refund'), 0) AS refunds,
    COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'expense' AND kind = 'normal'), 0)
      - COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'income' AND kind = 'refund'), 0) AS expense,
    COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'income'  AND kind = 'normal'), 0) AS income,
    COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'expense' AND kind = 'transfer'), 0) AS transfers_out,
    COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'income'  AND kind = 'transfer'), 0) AS transfers_in,
    COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'expense' AND kind = 'loan'), 0) AS loans_repaid,
    COALESCE(SUM(amount) FILTER (WHERE NOT scheduled AND type = 'income'  AND kind = 'loan'), 0) AS loans_borrowed,
    COALESCE(SUM(amount) FILTER (WHERE scheduled AND type = 'expense' AND kind = 'normal'), 0)
      - COALESCE(SUM(amount) FILTER (WHERE scheduled AND type = 'income' AND kind = 'refund'), 0) AS scheduled_expense,
    COALESCE(SUM(amount) FILTER (WHERE scheduled AND type = 'income' AND kind = 'normal'), 0) AS scheduled_income
  FROM t;
$$;

REVOKE EXECUTE ON FUNCTION public.monthly_totals(integer, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monthly_totals(integer, integer, date) TO authenticated;
