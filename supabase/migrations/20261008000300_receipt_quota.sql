-- =============================================================================
-- 20261008000300_receipt_quota.sql — レシート読み取りの回数制限（Issue #229 / テスト一覧 E: L1〜L6）
--
-- 1人 月30枚・1日5枚、アプリ全体 月3,000枚（社長アカウントは全体の上限から除く。本人決定 2026-10-08）。
-- 読み取り1回ごとに receipt_parse_logs に1行を「予約（reserved）」で入れ、終わったら
--   succeeded（数える）／ failed・cancelled（数えない: L6）
-- に閉じる。予約したまま5分たった行（途中で落ちた等）も数えない。
--
-- 予約は reserve_receipt_parse() の中で「ロック → 数える → 1行入れる」を1文で行う（L5 同時でも超えない）。
-- この関数は上限の値を引数で受けるので、利用者が直接呼べると上限を自分で緩められてしまう。
-- そのため anon・authenticated からは呼べないようにし、アプリのサーバー（lib/admin-db.ts）だけが呼ぶ。
-- 画像・読み取り結果は入れない（P5）。残すのは件数・モデル・トークン数・費用だけ。
-- =============================================================================

CREATE TABLE receipt_parse_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'reserved'
                            CHECK (status IN ('reserved', 'succeeded', 'failed', 'cancelled')),
  -- 全体の月3,000枚に数えるか（社長アカウントの分は false）
  counts_global BOOLEAN     NOT NULL DEFAULT TRUE,
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC(10, 6),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX receipt_parse_logs_user_created_idx ON receipt_parse_logs (user_id, created_at);
CREATE INDEX receipt_parse_logs_created_idx ON receipt_parse_logs (created_at) WHERE counts_global;

ALTER TABLE receipt_parse_logs ENABLE ROW LEVEL SECURITY;

-- 利用者は自分の記録を読めるだけ（残り回数の表示用）。書き込みはサーバーだけ
REVOKE ALL ON receipt_parse_logs FROM anon, authenticated;
GRANT SELECT ON receipt_parse_logs TO authenticated;
CREATE POLICY "receipt_parse_logs_select_own" ON receipt_parse_logs FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ------------------------------------------------------------
-- 数える行の条件: 成功、または予約から5分以内（処理中）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receipt_parse_counts(p_status text, p_created timestamptz, p_now timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_status = 'succeeded' OR (p_status = 'reserved' AND p_created > p_now - interval '5 minutes');
$$;

-- ------------------------------------------------------------
-- 使った枚数: 本人の今日・今月、全体の今月（日・月の区切りは JST: L2・L3）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receipt_usage(p_user uuid, p_now timestamptz DEFAULT now())
RETURNS TABLE (used_day integer, used_month integer, used_global integer)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH b AS (
    SELECT date_trunc('day',   p_now AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' AS day_start,
           date_trunc('month', p_now AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' AS month_start,
           (date_trunc('month', p_now AT TIME ZONE 'Asia/Tokyo') + interval '1 month') AT TIME ZONE 'Asia/Tokyo' AS next_month
  ), live AS (
    SELECT l.* FROM public.receipt_parse_logs l, b
     WHERE l.created_at >= b.month_start AND l.created_at < b.next_month
       AND public.receipt_parse_counts(l.status, l.created_at, p_now)
  )
  SELECT (SELECT count(*) FROM live, b WHERE live.user_id = p_user AND live.created_at >= b.day_start)::integer,
         (SELECT count(*) FROM live WHERE live.user_id = p_user)::integer,
         (SELECT count(*) FROM live WHERE live.counts_global)::integer;
$$;

-- ------------------------------------------------------------
-- 予約: 上限内なら1行入れて id を返す。超えていれば理由を返す（行は入れない）
--   reason: NULL（成功）/ 'user_day' / 'user_month' / 'global_month'
--   日・月の区切りは JST（L2・L3）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_receipt_parse(
  p_user           uuid,
  p_user_month     integer,
  p_user_day       integer,
  p_global_month   integer,
  p_exempt_global  boolean,
  p_now            timestamptz DEFAULT now()
)
RETURNS TABLE (log_id uuid, reason text, used_day integer, used_month integer, used_global integer)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_day         integer;
  v_month       integer;
  v_global      integer;
  v_id          uuid;
BEGIN
  -- 1. 全員の予約を1本に並べる（このトランザクションの終わりまで）。
  --    利用は多くても月3,000回なので、1本に並べても待ちは短い
  PERFORM pg_advisory_xact_lock(hashtext('receipt_parse_quota'));

  -- 2. 本人の今日・今月、全体の今月を数える（ロックの後なので、先に並んだ予約も見える）
  SELECT u.used_day, u.used_month, u.used_global INTO v_day, v_month, v_global
    FROM public.receipt_usage(p_user, p_now) u;

  -- 3. 上限の判定（本人の日 → 本人の月 → 全体の月 の順に、近い方の理由を返す）
  IF v_day >= p_user_day THEN
    RETURN QUERY SELECT NULL::uuid, 'user_day'::text, v_day, v_month, v_global;
    RETURN;
  END IF;
  IF v_month >= p_user_month THEN
    RETURN QUERY SELECT NULL::uuid, 'user_month'::text, v_day, v_month, v_global;
    RETURN;
  END IF;
  IF NOT p_exempt_global AND v_global >= p_global_month THEN
    RETURN QUERY SELECT NULL::uuid, 'global_month'::text, v_day, v_month, v_global;
    RETURN;
  END IF;

  -- 4. 予約を1行入れる
  INSERT INTO public.receipt_parse_logs (user_id, status, counts_global, created_at)
  VALUES (p_user, 'reserved', NOT p_exempt_global, p_now)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, NULL::text, v_day + 1, v_month + 1, v_global + (CASE WHEN p_exempt_global THEN 0 ELSE 1 END);
END;
$$;

-- 利用者からは呼べない（上限を引数で受けるため）。サーバーの管理者接続（postgres）だけが呼ぶ
REVOKE EXECUTE ON FUNCTION public.reserve_receipt_parse(uuid, integer, integer, integer, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.receipt_parse_counts(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.receipt_usage(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
