-- =============================================================================
-- 20261028100000_mcp.sql — 利用者の AI エージェントからの接続（/api/mcp、mywork#882）
-- 役割:
--   1. mcp_calls: AI からの道具の呼び出し記録（1分・1日の回数上限を数えるのと、「AI 接続まで行った人数」を数えるため）
--      中身（金額・メモ）は保存しない。道具の名前・接続した AI（client_id）・成否・時刻だけ
--   2. OAuth のトークンで DB を直接読ませない守り（RESTRICTIVE ポリシー）
--      Supabase の OAuth サーバーが AI に渡すトークンは、画面のログインと同じ authenticated ロールの JWT で、
--      client_id クレームだけが違う。そのままだと AI 側が anon キー（公開値）と組み合わせて
--      PostgREST を直接叩き、/api/mcp の道具に無い操作（削除・編集）までできてしまう。
--      そこで「client_id 付きの JWT では public の表に一切触れない」制限ポリシーを全表に足す。
--      アプリの経路（lib/db.ts の withUserDb）は claims に client_id を入れないので影響しない。
--      → AI ができることは /api/mcp の道具（追加・直前の取り消し・読む）だけになる
-- =============================================================================

-- ─── 1. 呼び出し記録 ──────────────────────────────────────────────────────────
CREATE TABLE mcp_calls (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id  TEXT        NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 200),
  tool       TEXT        NOT NULL CHECK (char_length(tool) BETWEEN 1 AND 64),
  is_write   BOOLEAN     NOT NULL DEFAULT false,
  ok         BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mcp_calls_user_created_idx ON mcp_calls (user_id, created_at DESC);

ALTER TABLE mcp_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mcp_calls FROM anon;

-- 本人は自分の記録の閲覧と追加だけ（書き換え・削除は許さない＝回数をごまかせない）
CREATE POLICY "mcp_calls_select_own" ON mcp_calls FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "mcp_calls_insert_own" ON mcp_calls FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT ON mcp_calls TO authenticated;

-- ─── 2. OAuth クライアントのトークンでは public の表に直接触れない ───────────────────
-- RLS が有効な public の表すべてに、同じ名前の RESTRICTIVE ポリシーを付ける。
-- RESTRICTIVE は既存の許可ポリシー（本人の行だけ）に「かつ」で効く。
-- 今後表を足したときも、この DO ブロックと同じ1行（CREATE POLICY ... AS RESTRICTIVE）を付けること。
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format(
      'CREATE POLICY "no_oauth_client_direct_access" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING ((SELECT auth.jwt() ->> ''client_id'') IS NULL) '
      'WITH CHECK ((SELECT auth.jwt() ->> ''client_id'') IS NULL)',
      t.relname
    );
  END LOOP;
END
$$;
