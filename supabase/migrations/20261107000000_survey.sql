-- =============================================================================
-- 20261107000000_survey.sql — 月1回の音声アンケート（mywork#1150 第3弾）
-- 役割:
--   - survey_rounds   : 1人1か月1回の回（open / done / skipped）
--   - survey_questions: その回の設問（第3弾は固定5問。第4弾で動的設問を入れても回の中では固定）
--   - survey_answers  : 回答の文字（文字起こしそのまま raw_text と、本人が OK した整形後 text）。音声は保存しない（Q5 A）
--   - 本人は自分の回だけ読み書き（RLS）。全削除（delete-all）と退会（auth.users の CASCADE）で消える
--   - OAuth クライアント（MCP）のトークンでは触れない（no_oauth_client_direct_access。20261028100000_mcp.sql の約束）
-- =============================================================================

CREATE TABLE survey_rounds (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month       TEXT        NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (user_id, month)
);

CREATE TABLE survey_questions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    UUID        NOT NULL REFERENCES survey_rounds(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position    SMALLINT    NOT NULL CHECK (position BETWEEN 1 AND 10),
  text        TEXT        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  kind        TEXT        NOT NULL CHECK (kind IN ('satisfaction', 'fixed', 'followup')),
  source      TEXT,
  tidy_count  SMALLINT    NOT NULL DEFAULT 0,
  UNIQUE (round_id, position)
);

CREATE TABLE survey_answers (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   UUID          NOT NULL UNIQUE REFERENCES survey_questions(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text      TEXT          NOT NULL CHECK (char_length(raw_text) <= 4000),
  text          TEXT          NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  score         SMALLINT      CHECK (score BETWEEN 0 AND 10),
  input         TEXT          NOT NULL CHECK (input IN ('voice', 'text')),
  model         TEXT,
  input_tokens  INT,
  output_tokens INT,
  cost_usd      NUMERIC(10,6),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX survey_questions_user_idx ON survey_questions (user_id);
CREATE INDEX survey_answers_user_idx   ON survey_answers (user_id);

ALTER TABLE survey_rounds    ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_answers   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_rounds    FROM anon;
REVOKE ALL ON survey_questions FROM anon;
REVOKE ALL ON survey_answers   FROM anon;

CREATE POLICY "survey_rounds_own" ON survey_rounds FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "survey_questions_own" ON survey_questions FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "survey_answers_own" ON survey_answers FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON survey_rounds    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_answers   TO authenticated;

-- OAuth クライアントのトークンでは直接触れない。第2弾の closing_* に付け忘れていたのもここで足す（あれば何もしない）
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['survey_rounds', 'survey_questions', 'survey_answers', 'closing_settings', 'closing_reports'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'no_oauth_client_direct_access') THEN
      EXECUTE format(
        'CREATE POLICY "no_oauth_client_direct_access" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING ((SELECT auth.jwt() ->> ''client_id'') IS NULL) '
        'WITH CHECK ((SELECT auth.jwt() ->> ''client_id'') IS NULL)',
        t
      );
    END IF;
  END LOOP;
END
$$;
