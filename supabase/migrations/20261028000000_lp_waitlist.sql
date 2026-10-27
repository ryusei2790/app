-- =============================================================================
-- 20261028000000_lp_waitlist.sql — 広告の着地ページの閲覧数と事前登録（mywork#878）
-- 役割: lp_views（着地ページを開いた記録）と waitlist_signups（メールだけの事前登録）を作る。
--   どちらも RLS 有効・ポリシー無し＝anon・ログイン利用者からは読めも書けもしない。
--   読み書きは lib/admin-db.ts 経由の API だけ（管理者接続）。IP・UA の全文は保存しない。
-- 新しい表を足すだけなので、コードが本番に出る前に当てても今の動きは変わらない。
-- =============================================================================

CREATE TABLE lp_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewed_at     timestamptz NOT NULL DEFAULT now(),
  visitor_id    text NOT NULL,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  referrer_host text
);
CREATE INDEX lp_views_visitor_viewed_idx ON lp_views (visitor_id, viewed_at DESC);
ALTER TABLE lp_views ENABLE ROW LEVEL SECURITY;

CREATE TABLE waitlist_signups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL UNIQUE CHECK (email = lower(email)),
  created_at   timestamptz NOT NULL DEFAULT now(),
  visitor_id   text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text
);
CREATE INDEX waitlist_signups_visitor_created_idx ON waitlist_signups (visitor_id, created_at DESC);
ALTER TABLE waitlist_signups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON lp_views, waitlist_signups FROM anon, authenticated;
