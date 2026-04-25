# カレンダー型家計簿

カレンダーで収支を一目で把握できる家計簿 Web アプリです。クレジットカードの CSV を取り込むだけで家計管理が完結します。

## スクリーンショット

| カレンダー | 収支入力モーダル |
|:---------:|:--------------:|
| ![カレンダー](docs/screenshots/01_calendar.png) | ![収支入力](docs/screenshots/02_calendar_modal.png) |

| ダッシュボード | 収支一覧 |
|:-------------:|:-------:|
| ![ダッシュボード](docs/screenshots/03_dashboard.png) | ![収支一覧](docs/screenshots/04_transactions.png) |

| 固定費管理 | CSVインポート |
|:---------:|:-----------:|
| ![固定費](docs/screenshots/05_fixed_costs.png) | ![CSVインポート](docs/screenshots/06_csv_import.png) |

| 口座管理 | カテゴリ管理 |
|:-------:|:----------:|
| ![口座管理](docs/screenshots/07_settings_accounts.png) | ![カテゴリ管理](docs/screenshots/08_settings_categories.png) |

---

## 機能一覧

| 機能 | 説明 |
|------|------|
| 📅 **カレンダー表示** | 月ごとに収支を日付マスに表示。当日をハイライト |
| ✏️ **収支手動入力** | 日付マスをクリックしてモーダルから収支を追加 |
| 📊 **ダッシュボード** | 月次の合計収入・支出・残高とカテゴリ別ドーナツグラフ |
| 📋 **収支一覧** | 月ごとの収支一覧。すべて・支出・収入でフィルター可能 |
| 🔁 **固定費自動生成** | 月額固定費を登録すると毎月自動で収支に追加 |
| 📥 **CSV インポート** | エポスカード・セゾンカードの CSV を取り込み |
| ⚙️ **口座管理** | 現金・クレジットカード・銀行口座を登録 |
| 🏷️ **カテゴリ管理** | デフォルト 13 カテゴリ＋カスタムカテゴリを追加可能 |

---

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | Next.js 16 (App Router, TypeScript) |
| スタイリング | Tailwind CSS |
| UI コンポーネント | shadcn/ui |
| グラフ | Recharts |
| 認証 | Supabase Auth |
| データベース | PostgreSQL (Supabase) |
| ORM | Prisma 7 |
| CSV パース | papaparse |
| ローカル開発 | Docker + Supabase CLI |

---

## ローカル開発環境のセットアップ

### 前提条件

- Node.js 18 以上
- Docker Desktop
- Supabase CLI

### 手順

**1. リポジトリをクローン**

```bash
git clone <repository-url>
cd kakebo_next/app
```

**2. 依存パッケージをインストール**

```bash
npm install
```

**3. Prisma クライアントを生成**

```bash
npx prisma generate
```

**4. Docker Desktop を起動してから Supabase をスタート**

```bash
supabase start
```

> 初回はイメージのダウンロードに 5〜10 分かかります。

**5. 接続情報を確認**

```bash
supabase status
```

出力例：

```
Project URL    : http://127.0.0.1:54321
Publishable    : sb_publishable_XXXXXXXXXX
Secret         : sb_secret_XXXXXXXXXX
DB URL         : postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

**6. `.env.local` を作成**

```bash
cp .env.local.example .env.local
```

`.env.local` を開いて `supabase status` の値を入力します：

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_XXXXXXXXXX
SUPABASE_SERVICE_ROLE_KEY=sb_secret_XXXXXXXXXX
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

**7. マイグレーションを適用**

```bash
supabase migration up
```

**8. 開発サーバーを起動**

```bash
npm run dev
```

**9. ブラウザで開く**

```
http://localhost:3000
```

---

## 使い方

### 1. アカウント登録

`/signup` からメールアドレスとパスワードで登録します。登録後は自動でログインされます。

### 2. 口座を登録する

設定（⚙️）→ 口座管理 から「+ 口座を追加」で現金・クレジットカード・銀行口座を登録します。

![口座管理](docs/screenshots/07_settings_accounts.png)

### 3. 収支を手動入力する

カレンダーの日付マスをクリックするとモーダルが開きます。支出・収入を選択して金額・カテゴリ・口座を入力して「保存」します。

![収支入力](docs/screenshots/02_calendar_modal.png)

カレンダーの日付マスに金額が反映され、月次サマリーも自動更新されます。

![カレンダー](docs/screenshots/01_calendar.png)

### 4. 固定費を登録する

固定費（🔁）画面から「+ 固定費を追加」で月額・引き落とし日・口座を登録します。トグルを ON にすると毎月ログイン時に自動で収支に追加されます。

![固定費](docs/screenshots/05_fixed_costs.png)

### 5. CSV をインポートする

CSV インポート（📥）画面でカード会社（エポス / セゾン）を選択し、口座を指定してから CSV ファイルをドラッグ＆ドロップします。

![CSVインポート](docs/screenshots/06_csv_import.png)

### 6. ダッシュボードで確認する

ダッシュボード（📊）では月ごとの合計収入・支出・残高とカテゴリ別の内訳をグラフで確認できます。

![ダッシュボード](docs/screenshots/03_dashboard.png)

### 7. 収支一覧を確認する

収支一覧（📋）では月ごとの全収支をテーブルで確認できます。「すべて・支出・収入」でフィルタリングが可能です。手動・固定費・CSV の種別バッジも表示されます。

![収支一覧](docs/screenshots/04_transactions.png)

---

## 対応 CSV フォーマット

| カード会社 | 取得方法 |
|----------|---------|
| エポスカード | エポスNet → 明細照会 → CSV ダウンロード |
| セゾンカード | セゾン Netアンサー → ご利用明細 → CSV ダウンロード |

---

## ディレクトリ構成

```
src/
├── app/
│   ├── (dashboard)/          # 認証済みページ群
│   │   ├── layout.tsx        # 共通レイアウト（サイドバー）
│   │   ├── calendar/         # カレンダー画面
│   │   ├── dashboard/        # ダッシュボード
│   │   ├── transactions/     # 収支一覧
│   │   ├── fixed-costs/      # 固定費管理
│   │   ├── import/           # CSV インポート
│   │   └── settings/         # 設定
│   ├── api/v1/               # API Routes
│   │   ├── transactions/
│   │   ├── categories/
│   │   ├── accounts/
│   │   ├── fixed-costs/
│   │   ├── import/
│   │   └── dashboard/
│   ├── login/                # ログイン画面
│   └── signup/               # 新規登録画面
├── components/
│   ├── layout/               # Sidebar, FixedCostGenerateTrigger
│   ├── calendar/             # CalendarView, CalendarDay
│   ├── dashboard/            # DashboardView
│   ├── transactions/         # TransactionView
│   ├── fixed-costs/          # FixedCostView
│   ├── import/               # CsvImportView
│   └── settings/             # SettingsView
├── hooks/
│   └── useTransactions.ts    # 収支データ取得・CRUD
├── lib/
│   ├── prisma.ts             # Prisma クライアント（Singleton）
│   ├── api-helpers.ts        # 認証・レスポンスヘルパー・シリアライザ
│   ├── supabase/             # Supabase クライアント
│   └── csv/                  # CSV パーサー（エポス・セゾン）
└── types/
    ├── api.ts                # API リクエスト・レスポンス型
    └── database.ts           # DB テーブル型定義
```

---

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Publishable キー |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Secret キー（サーバーサイドのみ） |
| `DATABASE_URL` | PostgreSQL 接続 URL（Prisma 用） |

---

## ライセンス

MIT
