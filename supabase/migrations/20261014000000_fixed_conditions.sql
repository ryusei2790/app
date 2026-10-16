-- =============================================================================
-- 20261014000000_fixed_conditions.sql — 固定の収入・固定の支出の判定（Issue #229 / テスト一覧 F1〜F8）
--
-- 定期（fixed_costs）に「当てはまる条件」を持たせる。手入力・CSV の取引のうち、
-- 種別・カテゴリー・メモの語句・金額がどれかの定期の条件にそろうものを「固定」として集計する。
-- 判定の結果は取引に保存せず、集計のたびに条件で決める（定期を直すと過去もさかのぼって直る: F6）。
--   - match_note       … メモに含まれる語句（大文字小文字を区別しない部分一致）。NULL なら見ない
--   - match_any_amount … true なら金額を見ない（値上げ・ドル建てで毎回変わるもの）
-- 表は増やさないので、RLS（自分の行だけ・TO authenticated）は既存の fixed_costs のポリシーがそのまま効く。
-- =============================================================================

ALTER TABLE fixed_costs
  ADD COLUMN match_note       TEXT CHECK (match_note IS NULL OR char_length(match_note) <= 50),
  ADD COLUMN match_any_amount BOOLEAN NOT NULL DEFAULT false;
