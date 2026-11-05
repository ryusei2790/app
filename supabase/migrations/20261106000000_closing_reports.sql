-- =============================================================================
-- 20261106000000_closing_reports.sql — 決算日の提案ボット（mywork#1150 第2弾）
-- 役割:
--   - closing_settings: 本人の決算日（1〜28日。NULL＝月末＝既定）
--   - closing_reports : 月ごとの提案（Markdown）。1か月1行で、作り直すと上書き（generations を数える）
--   - 本人は自分の行だけ読み書き（RLS）。退会・全削除は auth.users の ON DELETE CASCADE で消える
--   - AI に渡すのは月の集計（カテゴリー別の合計など）だけ。取引のメモ・店名は渡さず、ここにも保存しない
-- =============================================================================

CREATE TABLE closing_settings (
  user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  closing_day SMALLINT    CHECK (closing_day BETWEEN 1 AND 28),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE closing_reports (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month         TEXT          NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  markdown      TEXT          NOT NULL CHECK (char_length(markdown) BETWEEN 1 AND 20000),
  model         TEXT,
  input_tokens  INT,
  output_tokens INT,
  generations   INT           NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

ALTER TABLE closing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE closing_reports  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON closing_settings FROM anon;
REVOKE ALL ON closing_reports  FROM anon;

CREATE POLICY "closing_settings_own" ON closing_settings FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "closing_reports_select_own" ON closing_reports FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "closing_reports_insert_own" ON closing_reports FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "closing_reports_update_own" ON closing_reports FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE ON closing_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON closing_reports  TO authenticated;
