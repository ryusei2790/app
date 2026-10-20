-- =============================================================================
-- 20261020000000_fixed_currency.sql — ドル建ての定期（Issue #229 残り②）
--
-- 定期（fixed_costs）に通貨を持たせる。USD のときは amount をドル（小数2桁まで）として持ち、
-- 取引にするとき（lib/fixed-costs/expand.ts）にその日のドル円で円に直して入れる。
-- 取引（transactions）は今までどおり円だけ。表は増やさないので RLS は既存のポリシーがそのまま効く。
-- =============================================================================

ALTER TABLE fixed_costs
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency IN ('JPY', 'USD'));
