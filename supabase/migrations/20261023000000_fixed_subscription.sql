-- =============================================================================
-- 20261023000000_fixed_subscription.sql — サブスクの管理欄（mywork#742 ②）
--
-- 定期（fixed_costs）に、サブスクを管理するための欄を6つ足す（設計書 docs/2026-10-23_サブスク管理_設計.md §1）。
-- 全部任意（既定は false / NULL）なので、既存の定期は何も変わらない。
-- 表は増やさないので RLS は既存のポリシーがそのまま効く。
-- URL は http/https だけ（javascript: などをリンクにさせない）。入力の検査は API（lib/validation/fixed-cost.ts）でも行い、
-- ここの CHECK は API を通らない書き込みへの最後の守り。
-- 戻すとき: ALTER TABLE fixed_costs DROP COLUMN is_subscription, DROP COLUMN manage_url, DROP COLUMN cancel_url,
--           DROP COLUMN next_renewal_date, DROP COLUMN payment_card, DROP COLUMN memo;（入れた値は消える）
-- =============================================================================

ALTER TABLE fixed_costs
  ADD COLUMN is_subscription   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN manage_url        TEXT CHECK (manage_url IS NULL OR (manage_url ~* '^https?://' AND length(manage_url) <= 2000)),
  ADD COLUMN cancel_url        TEXT CHECK (cancel_url IS NULL OR (cancel_url ~* '^https?://' AND length(cancel_url) <= 2000)),
  ADD COLUMN next_renewal_date DATE,
  ADD COLUMN payment_card      TEXT CHECK (payment_card IS NULL OR length(payment_card) <= 50),
  ADD COLUMN memo              TEXT CHECK (memo IS NULL OR length(memo) <= 500);
