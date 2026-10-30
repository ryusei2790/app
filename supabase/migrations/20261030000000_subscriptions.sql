-- =============================================================================
-- 20261030000000_subscriptions.sql — 有料プランの状態（mywork#970）
-- 役割: subscriptions（1人1行）を作る。書くのは署名検証済みの Stripe Webhook だけ（管理者接続）。
--   ログイン利用者は自分の行を読むだけ。anon は何もできない。カード情報は持たない。
-- 新しい表を足すだけなので、コードが本番に出る前に当てても今の動きは変わらない。
-- 戻すときは DROP TABLE subscriptions;
-- =============================================================================

CREATE TABLE subscriptions (
  user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text NOT NULL UNIQUE,
  stripe_subscription_id text NOT NULL UNIQUE,
  status                 text NOT NULL,
  current_period_end     timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON subscriptions FROM anon, authenticated;
GRANT SELECT ON subscriptions TO authenticated;

CREATE POLICY subscriptions_select_own ON subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- AI エージェント接続（OAuth のトークン）からは読めなくする（20261028100000_mcp.sql と同じ）
CREATE POLICY "no_oauth_client_direct_access" ON subscriptions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'client_id') IS NULL)
  WITH CHECK ((SELECT auth.jwt() ->> 'client_id') IS NULL);
