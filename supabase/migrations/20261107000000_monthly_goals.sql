-- =============================================================================
-- 20261107000000_monthly_goals.sql — 決算から月の目標を決める（mywork#1238 第2弾）
-- 役割:
--   - monthly_goals: 月ごとの支出の目標額（円）。1か月1行で、決め直すと上書き
--   - from_month  : どの月の決算を見て決めたか（さかのぼって決算した月。手で入れたなら NULL）
--   - 本人は自分の行だけ読み書き・消す（RLS）。退会は auth.users の ON DELETE CASCADE で消える
--   - 金額は本人が決めた目標だけ。AI には目標額（数字1つ）だけを決算の集計と一緒に渡す
-- 本番への適用は本人（supabase db push）。適用前は目標の保存が 500 になるが、決算の画面の他の部分は動く
-- =============================================================================

CREATE TABLE monthly_goals (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month        TEXT        NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  expense_goal INT         NOT NULL CHECK (expense_goal BETWEEN 1 AND 99999999),
  from_month   TEXT        CHECK (from_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

ALTER TABLE monthly_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON monthly_goals FROM anon;

CREATE POLICY "monthly_goals_own" ON monthly_goals FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON monthly_goals TO authenticated;
