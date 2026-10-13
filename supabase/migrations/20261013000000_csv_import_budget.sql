-- =============================================================================
-- 20261013000000_csv_import_budget.sql — CSV 移行と予算枠（Issue #229 3回目 / テスト一覧 I・M・S9〜S12）
--
-- 1. transactions.import_key … CSV の「行の目印」（lib/csv/import-key.ts）。利用者ごとに一意にして、
--    同じ CSV を何回入れても・期間の重なる書き出しを入れても取引が増えないようにする（I4〜I6・S10）。
--    消した取引の目印も残す（消した行を次の取り込みで復活させない）ので、deleted_at では絞らない
-- 2. budget_frames … 予算の費目（食費・サブスク・…の8つ）と月の上限・目標
-- 3. budget_rules  … カテゴリー／メモの語句 → 費目の対応表。frame_id が NULL なら「枠の外」
--    振り分けの結果は取引に保存せず、集計のたびにこの表で決める（対応表を直すと過去も直る: M7）
-- どちらの表も RLS は TO authenticated・自分の行だけ。参照するカテゴリー・費目も自分のもの（S9）。
-- =============================================================================

-- ------------------------------------------------------------
-- 1. 行の目印
-- ------------------------------------------------------------
ALTER TABLE transactions ADD COLUMN import_key TEXT CHECK (import_key IS NULL OR char_length(import_key) <= 100);

CREATE UNIQUE INDEX transactions_user_import_key_uniq
  ON transactions (user_id, import_key)
  WHERE import_key IS NOT NULL;

-- ------------------------------------------------------------
-- 2. 予算の費目
-- ------------------------------------------------------------
CREATE TABLE budget_frames (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  monthly_limit INTEGER     NOT NULL CHECK (monthly_limit >= 0),
  target        INTEGER     CHECK (target IS NULL OR target >= 0),
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- ------------------------------------------------------------
-- 3. 対応表
-- ------------------------------------------------------------
CREATE TABLE budget_rules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id  UUID        REFERENCES categories(id) ON DELETE CASCADE,
  memo_keyword TEXT        CHECK (memo_keyword IS NULL OR char_length(memo_keyword) BETWEEN 1 AND 50),
  frame_id     UUID        REFERENCES budget_frames(id) ON DELETE CASCADE,
  priority     INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- カテゴリーか語句のどちらかは要る（両方なしのルールは全部に当たってしまう）
  CONSTRAINT budget_rules_has_condition CHECK (category_id IS NOT NULL OR memo_keyword IS NOT NULL)
);

CREATE INDEX budget_rules_user_idx ON budget_rules (user_id);

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------
ALTER TABLE budget_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_rules  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON budget_frames, budget_rules FROM anon;

CREATE OR REPLACE FUNCTION public.owns_budget_frame(p_frame_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_frame_id IS NULL OR EXISTS (
    SELECT 1 FROM public.budget_frames f
     WHERE f.id = p_frame_id AND f.user_id = (SELECT auth.uid())
  );
$$;
REVOKE EXECUTE ON FUNCTION public.owns_budget_frame(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_budget_frame(uuid) TO authenticated;

CREATE POLICY "budget_frames_select_own" ON budget_frames FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "budget_frames_insert_own" ON budget_frames FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "budget_frames_update_own" ON budget_frames FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "budget_frames_delete_own" ON budget_frames FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 対応表: 自分のもの、かつ指すカテゴリー（共通も可）・費目も自分のもの
CREATE POLICY "budget_rules_select_own" ON budget_rules FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "budget_rules_insert_own" ON budget_rules FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_use_category(category_id)
    AND public.owns_budget_frame(frame_id)
  );
CREATE POLICY "budget_rules_update_own" ON budget_rules FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_use_category(category_id)
    AND public.owns_budget_frame(frame_id)
  );
CREATE POLICY "budget_rules_delete_own" ON budget_rules FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
