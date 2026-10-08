-- =============================================================================
-- 20261008000400_receipts.sql — レシート情報（Issue #229 / テスト一覧 D: P5・P8）
--
-- 利用者が確認・修正して「保存」したレシートだけを入れる（読み取っただけでは入らない: P8）。
-- 1枚 = 1取引。取引（transactions, source='receipt'）とこの表を1つの DB トランザクションで作る。
-- 画像・画像の置き場は作らない（P5）。残すのは店名・日付・合計・明細の文字だけ。
-- 明細は別表にせず items（jsonb）に入れる（設計書 2-2 データモデル。社長の台帳への書き出しもここから読む）。
-- =============================================================================

-- 取引の作られ方に receipt を足す
ALTER TABLE transactions DROP CONSTRAINT transactions_source_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_source_check CHECK (source IN ('manual', 'csv', 'auto', 'api', 'receipt'));

CREATE TABLE receipts (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id UUID          NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  merchant       TEXT          NOT NULL CHECK (char_length(merchant) BETWEEN 1 AND 200),
  purchased_at   DATE          NOT NULL,
  total          NUMERIC(12,2) NOT NULL CHECK (total > 0 AND total = trunc(total)),
  items          JSONB         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  model          TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX receipts_user_idx ON receipts (user_id, purchased_at);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON receipts FROM anon;

-- 自分のものだけ。取引も自分のものでなければ紐付けられない
CREATE OR REPLACE FUNCTION public.owns_transaction(p_transaction_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.id = p_transaction_id AND t.user_id = (SELECT auth.uid())
  );
$$;
REVOKE EXECUTE ON FUNCTION public.owns_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_transaction(uuid) TO authenticated;

CREATE POLICY "receipts_select_own" ON receipts FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "receipts_insert_own" ON receipts FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.owns_transaction(transaction_id));
CREATE POLICY "receipts_update_own" ON receipts FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.owns_transaction(transaction_id));
CREATE POLICY "receipts_delete_own" ON receipts FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
