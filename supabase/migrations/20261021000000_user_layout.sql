-- =============================================================================
-- 20261021000000_user_layout.sql — マイメニューとチャットの回数（mywork#573 第1弾）
-- 役割:
--   - user_layout: 本人がチャットで足した機能（マイメニュー）。行がある＝表示。並び順・アイコン・表示名を持つ
--     固定の5つ（ホーム・レシート・収支一覧・チャット・設定）はコード側で固定し、ここには入れない
--   - chat_usage : チャットの回数（1日あたり）。上限を数えるためだけで、会話の中身は保存しない
-- 既存の利用者は、今まで出ていた残りのメニューをマイメニューへ入れて見た目の変化を小さくする（設計 Q1 A）。
-- 予算台帳（budget）は全員に入れるが、画面に出すのは社長だけ（カタログ側で isOwner を見る）。
-- =============================================================================

CREATE TABLE user_layout (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_id TEXT        NOT NULL CHECK (char_length(feature_id) BETWEEN 1 AND 50),
  position   INTEGER     NOT NULL DEFAULT 0,
  icon       TEXT        CHECK (icon IS NULL OR char_length(icon) <= 8),
  label      TEXT        CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 20),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_id)
);

CREATE TABLE chat_usage (
  user_id UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day     DATE    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE user_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_usage  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_layout, chat_usage FROM anon;

CREATE POLICY "user_layout_select_own" ON user_layout FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "user_layout_insert_own" ON user_layout FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "user_layout_update_own" ON user_layout FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "user_layout_delete_own" ON user_layout FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "chat_usage_select_own" ON chat_usage FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "chat_usage_insert_own" ON chat_usage FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "chat_usage_update_own" ON chat_usage FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON user_layout TO authenticated;
GRANT SELECT, INSERT, UPDATE ON chat_usage TO authenticated;

-- 既存の利用者: 今のメニューの残りをマイメニューへ（並びも今と同じ）
INSERT INTO user_layout (user_id, feature_id, position)
SELECT p.id, f.feature_id, f.position
  FROM profiles p
 CROSS JOIN (VALUES
   ('dashboard', 0), ('review', 1), ('import', 2), ('fixed-costs', 3), ('definitions', 4), ('budget', 5)
 ) AS f(feature_id, position)
ON CONFLICT DO NOTHING;
