-- =============================================================================
-- 20261008000100_transaction_rules.sql — 金額のルールを DB でも守る（Issue #229 / テスト T1）
-- 金額は「1円以上の整数円」だけ。アプリ（lib/validation/transaction.ts）でも同じ確認をしているが、
-- ブラウザから supabase-js で直接書かれた場合にも効くよう、DB の CHECK 制約でも止める。
-- 列の型（NUMERIC(12,2)）は Prisma スキーマと合わせるため変えない。
-- =============================================================================

ALTER TABLE transactions
  ADD CONSTRAINT transactions_amount_positive_yen
  CHECK (amount > 0 AND amount = trunc(amount));

ALTER TABLE fixed_costs
  ADD CONSTRAINT fixed_costs_amount_positive_yen
  CHECK (amount > 0 AND amount = trunc(amount));
