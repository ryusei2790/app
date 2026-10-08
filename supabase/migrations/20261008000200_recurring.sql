-- =============================================================================
-- 20261008000200_recurring.sql — 定期支出の作り直し（Issue #229 / テスト一覧 C: R1〜R9）
--
-- 旧来の弱点3つ「支出のみ・毎月のみ・開いた月だけ」を直す。
--   - type            : 支出だけでなく収入の定期も持てる（R4）
--   - cycle           : 毎週・隔週・毎月・毎年（R2）。毎週・隔週は start_date の曜日が基準
--   - billing_month   : 毎年払いの月（1〜12）
--   - start_date / end_date : ここから・ここまで（R7）
--   - generated_through     : 「この日まで展開済み」の印（R5・R6・R7・R8）
--       展開処理は (generated_through, 今日] の支払日だけを作り、最後に今日を書き込む。
--       → 何度走っても同じ日を2回作らない／抜けた期間はまとめて補完される／
--         編集しても印より前（＝作成済み）の取引には触れない
-- さらに、同じ定期から同じ日の取引が2件できないよう一意索引で DB でも止める（同時実行の保険）。
-- =============================================================================

ALTER TABLE fixed_costs
  ADD COLUMN type              TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
  ADD COLUMN cycle             TEXT NOT NULL DEFAULT 'monthly'
                               CHECK (cycle IN ('weekly', 'biweekly', 'monthly', 'yearly')),
  ADD COLUMN billing_month     INTEGER CHECK (billing_month BETWEEN 1 AND 12),
  ADD COLUMN start_date        DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Tokyo')::date),
  ADD COLUMN end_date          DATE,
  ADD COLUMN generated_through DATE;

-- 毎週・隔週は billing_day を使わない（開始日の曜日で決まる）ので NULL を許す
ALTER TABLE fixed_costs ALTER COLUMN billing_day DROP NOT NULL;

ALTER TABLE fixed_costs
  ADD CONSTRAINT fixed_costs_billing_day_required
    CHECK (cycle IN ('weekly', 'biweekly') OR billing_day IS NOT NULL),
  ADD CONSTRAINT fixed_costs_billing_month_required
    CHECK (cycle <> 'yearly' OR billing_month IS NOT NULL),
  ADD CONSTRAINT fixed_costs_end_after_start
    CHECK (end_date IS NULL OR end_date >= start_date);

-- 既存の行: 登録日（JST）を開始日にし、作成済みの最後の日を「展開済み」の印にする
-- （旧処理は月の分を先に作っていたので、その日まで作り直さないようにする）
UPDATE fixed_costs f
   SET start_date = (f.created_at AT TIME ZONE 'Asia/Tokyo')::date,
       generated_through = (
         SELECT max(t.transaction_date) FROM transactions t WHERE t.fixed_cost_id = f.id
       );

-- 同じ定期・同じ日の自動取引は1件まで（消した取引は数えない）
CREATE UNIQUE INDEX transactions_fixed_cost_date_uniq
  ON transactions (fixed_cost_id, transaction_date)
  WHERE fixed_cost_id IS NOT NULL AND deleted_at IS NULL;

-- 定期を削除しても、作成済みの取引は家計簿の記録として残す（R8）。
-- 以前は参照が残っていると削除が FK 違反（500）になっていた
ALTER TABLE transactions DROP CONSTRAINT transactions_fixed_cost_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_fixed_cost_id_fkey
  FOREIGN KEY (fixed_cost_id) REFERENCES fixed_costs(id) ON DELETE SET NULL;

-- 定期実行（cron）が「展開が必要な人」を探すための索引
CREATE INDEX fixed_costs_active_user_idx ON fixed_costs (user_id) WHERE is_active;
