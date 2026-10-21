-- =============================================================================
-- 20261022000000_feature_requests.sql — 無い機能の要望（mywork#573 第2弾）
-- 役割:
--   - feature_requests: チャットで「その機能はまだ無い」となったとき、本人の確認を取って保存する要望文
--     会話そのものは保存しない（要望文だけ）。status は 受付→対応中→完了／見送り
--   - 本人は自分の分の作成・閲覧だけ。社長の全件一覧と状態の変更は管理者接続（lib/admin-db.ts）で行う
-- =============================================================================

CREATE TABLE feature_requests (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text       TEXT        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  status     TEXT        NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_progress', 'done', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX feature_requests_user_created_idx ON feature_requests (user_id, created_at DESC);

ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON feature_requests FROM anon;

CREATE POLICY "feature_requests_select_own" ON feature_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
-- 作るときは必ず「受付」から（本人が状態を書き換えられないよう UPDATE は許さない）
CREATE POLICY "feature_requests_insert_own" ON feature_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'received');

GRANT SELECT, INSERT ON feature_requests TO authenticated;
