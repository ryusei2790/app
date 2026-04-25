-- =============================================================================
-- 20260424000000_init.sql — 初期マイグレーション
-- 役割: 全テーブルの作成、RLS ポリシーの設定、デフォルトカテゴリの投入、
--       auth.users → profiles の自動作成トリガーを定義する。
-- =============================================================================

-- ============================================================
-- profiles テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT        UNIQUE,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS 有効化
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 自分のプロフィールのみ参照・更新可能
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- ============================================================
-- accounts テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('cash', 'credit_card', 'bank')),
  currency    TEXT        NOT NULL DEFAULT 'JPY',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_own" ON accounts
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- categories テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL = システム共通
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('income', 'expense')),
  color       TEXT,
  icon        TEXT,
  is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- 共通カテゴリ（user_id IS NULL）または自分のカテゴリのみ参照可能
CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

-- 自分のカテゴリのみ作成・更新・削除可能（共通カテゴリは変更不可）
CREATE POLICY "categories_write" ON categories
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- fixed_costs テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS fixed_costs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   UUID        NOT NULL REFERENCES accounts(id),
  category_id  UUID        REFERENCES categories(id),
  name         TEXT        NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  billing_day  INTEGER     NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fixed_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fixed_costs_own" ON fixed_costs
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- csv_imports テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS csv_imports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id    UUID        NOT NULL REFERENCES accounts(id),
  filename      TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'error')),
  row_count     INTEGER     NOT NULL DEFAULT 0,
  skipped_count INTEGER     NOT NULL DEFAULT 0,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE csv_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "csv_imports_own" ON csv_imports
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- transactions テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id       UUID        NOT NULL REFERENCES accounts(id),
  category_id      UUID        REFERENCES categories(id),
  fixed_cost_id    UUID        REFERENCES fixed_costs(id),
  amount           NUMERIC(12,2) NOT NULL,
  type             TEXT        NOT NULL CHECK (type IN ('income', 'expense')),
  transaction_date DATE        NOT NULL,
  note             TEXT,
  source           TEXT        NOT NULL CHECK (source IN ('manual', 'csv', 'auto', 'api')),
  csv_import_id    UUID        REFERENCES csv_imports(id),
  deleted_at       TIMESTAMPTZ,                -- NULL なら有効（論理削除）
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_own" ON transactions
  FOR ALL USING (auth.uid() = user_id);

-- updated_at を自動更新するトリガー関数
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- auth.users → profiles 自動作成トリガー
-- 初回ログイン時に profiles レコードを自動生成する
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- デフォルトカテゴリ投入（user_id = NULL = システム共通）
-- ============================================================
INSERT INTO categories (name, type, color, icon, is_default) VALUES
  -- 支出カテゴリ
  ('食費',     'expense', '#FF6B6B', 'utensils',      TRUE),
  ('交通費',   'expense', '#4ECDC4', 'train',         TRUE),
  ('日用品',   'expense', '#45B7D1', 'shopping-bag',  TRUE),
  ('娯楽',     'expense', '#96CEB4', 'gamepad',       TRUE),
  ('医療',     'expense', '#FFEAA7', 'heart-pulse',   TRUE),
  ('通信',     'expense', '#DDA0DD', 'smartphone',    TRUE),
  ('衣服',     'expense', '#F0E68C', 'shirt',         TRUE),
  ('外食',     'expense', '#FFB347', 'coffee',        TRUE),
  ('その他',   'expense', '#D3D3D3', 'more-horizontal',TRUE),
  -- 収入カテゴリ
  ('給与',     'income',  '#98FB98', 'briefcase',     TRUE),
  ('ボーナス', 'income',  '#87CEEB', 'gift',          TRUE),
  ('副収入',   'income',  '#DEB887', 'trending-up',   TRUE),
  ('その他収入','income', '#E0E0E0', 'plus-circle',   TRUE);
