# 運用手順書（本番の家計簿 kakebo）

最終更新: 2026-10-25（mywork#764 ⑤）

本番を動かし続けるための手順を1か所にまとめたもの。開発環境の立ち上げとテストは `README.md`、経緯と細かい決定は `../docs/procedures.md`・`../docs/log.md`（app リポの外、kakebo_next/docs）。
**値（鍵・パスワード・金額）はこのファイル・git・Issue に書かない。**

| もの | 場所 |
|---|---|
| 本番 URL | https://kakebo-omega.vercel.app |
| Vercel | 個人アカウントのプロジェクト `ryusei-uedas-projects/kakebo`（Hobby）。CLI は `--global-config ~/.config/vercel-personal` を付ける |
| Supabase | プロジェクト `kakebo`（東京・Free）ref `vqimpbelkydklhuhhdpg` |
| DB パスワード | Mac のキーチェーン `kakebo-supabase-db` / `postgres` |
| バックアップの鍵 | キーチェーン `kakebo-backup-age` / `kakebo`（控えは本人のパスワード管理アプリ） |

## 1. デプロイ
- main に入れば Vercel が自動で本番に出す。手で `vercel deploy --prod` はしない
- 流れ: 作業ブランチ → PR → テスト Green → 本人 OK → `gh pr merge <N> --rebase`（**Rebase のみ**。単独のコマンドで打つ）
- コミットの作者は `ryusei2790`（このリポは frural 系4リポの「作者 crypto 固定」の対象外）。GitHub の画面で直接編集しない
- マージ後は main の commit status で Vercel が success か確かめる:
  `gh api repos/ryusei2790/app/commits/main/status -q '.statuses[]|select(.context=="Vercel")|.state'`
- 本番 URL への curl は最後に1回だけ（連打すると約10分 403）。`curl -s https://kakebo-omega.vercel.app/api/health` → `{"db":true,"cron":true}`
- 戻す: 直前の良いデプロイを Vercel の画面で「Promote to Production」（本人）か、revert の PR を Rebase マージ

## 2. migration の当て方
- 新しい表・列は `supabase migration new <名前>` で `supabase/migrations/` に SQL を1本足し、`prisma/schema.prisma` を手で合わせて `npx prisma generate`。新しい表には RLS（`auth.uid() = user_id`）を必ず付ける
- ローカルで `supabase db reset` → `npm run test:all`
- 本番（本人 OK 後。1コマンドずつ。autoMode.allow の #229 の行があれば AI も打てる）:
  ```bash
  cd ~/Mywork/dev/kakebo_next/app
  supabase link --project-ref vqimpbelkydklhuhhdpg
  SUPABASE_DB_PASSWORD="$(security find-generic-password -s kakebo-supabase-db -a postgres -w)" supabase db push --dry-run
  SUPABASE_DB_PASSWORD="$(security find-generic-password -s kakebo-supabase-db -a postgres -w)" supabase db push
  ```
- 順番: 列や制約を**広げる**だけの migration はコードより先に当ててよい。狭める・消すものはコードを出して使われなくなってから

## 3. 鍵の更新
本番の環境変数（Production のみ。Preview には入れない）: `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`・`DATABASE_URL`・`CRON_SECRET`・`OWNER_USER_IDS`・`RECEIPT_PARSER`・`RECEIPT_MODEL`・`RECEIPT_PROVIDER_ORDER`・`ANTHROPIC_API_KEY`・`OPENROUTER_API_KEY`・`NEXT_PUBLIC_GOOGLE_CLIENT_ID`。名前の一覧は `vercel env ls production --global-config ~/.config/vercel-personal`（値は出ない）

| 鍵 | 新しくする人と手順 |
|---|---|
| `ANTHROPIC_API_KEY`（レシート読取） | 本人: console.anthropic.com → API Keys → 新しいキー（家計簿専用）を作る → Vercel の kakebo → Settings → Environment Variables で貼り替え（Production・Sensitive）→ 古いキーを Anthropic 側で無効化 |
| `OPENROUTER_API_KEY` | 同じ流れを openrouter.ai → Keys で。今 `RECEIPT_PARSER` が openrouter でなければ使われていない |
| `CRON_SECRET` | AI でよい: `openssl rand -hex 32 \| vercel env add CRON_SECRET production --sensitive --force --global-config ~/.config/vercel-personal`（値を画面に出さない） |
| `DATABASE_URL`・DB パスワード | 本人: Supabase の Database → Reset password → キーチェーン `kakebo-supabase-db` を更新 → Vercel の `DATABASE_URL`（Supavisor 6543）を貼り替え |

- 環境変数を変えただけでは本番に効かない。次の main への push（小さな PR のマージ）で反映される
- 反映後に `/api/health` を1回見る。レシート読取は本人がスマホで1枚読ませて確かめる
- 鍵が漏れたかもしれないときは、上の手順で**すぐ**作り直して古いものを無効化する（漏れた値は git の履歴からも消えないので、消すより無効化）

## 4. 費用の上限
| もの | 上限・無料枠 | 見張り |
|---|---|---|
| Vercel Hobby | 無料。超えると止まる（請求は来ない） | ④の見張りがデプロイ失敗を見る |
| Supabase Free | DB 500MB。7日アクセスが無いと休止 | ④の見張りが毎日 `/api/health` で DB を1回読む＝休止の予防 |
| Anthropic（レシート読取） | **Console の Limits で月の上限を付ける**（$5/月程度）。アプリ側の回数上限 `RECEIPT_QUOTA_USER_DAY`/`_USER_MONTH`/`_GLOBAL_MONTH`（既定 5/30/3000） | 使った額は Console の Usage。アプリの使用回数は設定画面 |
| OpenRouter | Keys のキーごとの上限（$5/月など） | openrouter.ai の Activity |
| Google Drive（バックアップ） | 本人の Drive 容量 | 直近8本＋月初12か月だけ残す |

## 5. バックアップ・監視の確認と復元（②④）
- 定期バックアップ: 毎週日曜 10:00 `com.ryusei.kakebo-backup` → Drive `マイドライブ/家計簿バックアップ/YYYY-MM-DD_kakebo-full.json.age`。ログ `~/Library/Logs/kakebo-backup.log`
- バックアップの鮮度: 毎日 12:00 `com.ryusei.kakebo-backup-check`。最新が8日より古ければ俺待ち Issue
- 見張り: 毎日 12:30 `com.ryusei.kakebo-monitor`（health・Vercel・バックアップ失敗）。駄目なら俺待ち Issue（同じ題名が開いていれば立てない）。ログ `~/Library/Logs/kakebo-monitor.log`
- 動いているかの確認: `launchctl list | grep kakebo`（3つ出る）、`tail ~/Library/Logs/kakebo-*.log`
- 手で流す: `bash ~/.local/share/kakebo-backup/scripts/backup/run.sh`（端末から流すと結果の1行が画面にも出る）／`bash ~/.local/share/kakebo-backup/scripts/monitor/check.sh`
- 設定し直す（Mac を替えた・壊れた）: `bash scripts/backup/setup.sh` → `bash scripts/monitor/setup.sh`（何度流しても壊れない）
- 止める: `launchctl bootout gui/$(id -u)/<ラベル>`
- **復元**（データを失ったとき）:
  1. Drive の最新 `.age` を Mac に落とし、鍵で戻す（コマンドは `../docs/procedures.md`「定期バックアップ・復元」の 1.）
  2. アプリ → 設定 →「データと書き出し」→ 今の分を完全形式で書き出す →「全削除」
  3. 同じ画面の「復元」で JSON を選ぶ（空の帳簿にだけ入る。4MB まで）
  4. 件数を見て、もう一度書き出して元と同じか確かめる。戻した JSON（暗号化されていない）は消す
- 年1回（11月）の復元テストはローカル Supabase だけで `scripts/backup/restore-drill.ts`（使い方はファイル冒頭）。本番では試さない

## 6. 困ったとき
| 症状 | 見るところ |
|---|---|
| 画面が「うまくいきませんでした」 | Vercel の kakebo → Logs（関数のエラー）。`vercel logs kakebo-omega.vercel.app --global-config ~/.config/vercel-personal` |
| 定期の自動作成が止まった | `/api/health` の `cron` が false。Vercel → Cron Jobs の実行履歴、`CRON_SECRET` の有無 |
| DB に繋がらない | Supabase のダッシュボードで休止していないか（休止なら Restore）。`DATABASE_URL` が 6543（Supavisor）か |
| Vercel が Blocked・失敗 | ビルドログ `vercel inspect --logs <URL> --global-config ~/.config/vercel-personal`。直す PR を出して Rebase マージ |
| AI からつながらない（401 が続く） | Supabase → Authentication → OAuth Server が Enable か、Site URL が本番か。`/.well-known/oauth-protected-resource/api/mcp` の `authorization_servers` が本番の Supabase か（7.） |

## 7. AI との接続（/api/mcp、mywork#882）
利用者が自分の AI（Claude・ChatGPT・Claude Code）に `https://kakebo-omega.vercel.app/api/mcp` を登録すると、OAuth（Supabase Auth の OAuth 2.1 サーバー）でログイン・同意して家計簿を読み書きできる。AI ができるのは読むこと・支出の追加・AI が直前に足した1件の取り消しだけ。

| もの | 場所 |
|---|---|
| 窓口 | `src/app/api/mcp/route.ts`（道具は `src/lib/mcp/tools.ts`） |
| 同意画面 | `/oauth/consent`（Supabase の Authorization path と同じ） |
| 呼び出し記録・回数上限 | 表 `mcp_calls`（1人 1分60回・書き込み24時間200回。`src/lib/mcp/rate-limit.ts`） |
| OAuth トークンで DB を直接触らせない守り | 全表の RESTRICTIVE ポリシー `no_oauth_client_direct_access`（**表を足したら同じものを付ける**。付け忘れは `tests/db/mcp-rls.test.ts` の R5 が落ちる） |

- **本番の Auth 設定（本人の GUI）**: OAuth Server を Enable・Authorization path `/oauth/consent`・Dynamic Client Registration を ON／Site URL＝本番／Email の新規登録 ON・Confirm email ON／**Secure password change ON・Require current password when updating ON**（OAuth のトークンでも `/auth/v1/user` は呼べるため、AI 側にパスワードを変えさせない）
- **何人が AI までつないだか**（広告の数字。金額は出ない）: Supabase の SQL Editor で
  `select count(distinct user_id) as users, count(*) as calls from mcp_calls where created_at > now() - interval '14 days';`
- **1人の接続を切る**: 本人なら 設定 →「AI との接続」→「解除」。管理側からは Supabase → Authentication → OAuth Apps で該当のクライアントを削除
- **全員の AI 接続を止める（事故のとき）**: Supabase → Authentication → OAuth Server を Disable（新しい接続も既存のトークンの更新も止まる。発行済みのアクセストークンは最長1時間で切れる）。画面のログインには影響しない
- **月次決算を Claude Code から行う**: `npx --yes tsx@4.23.15 scripts/mcp/connect.ts https://kakebo-omega.vercel.app <書き出す mcp-config.json>` → 出た URL を本人がブラウザで開いて「許可する」→ `claude -p "<決算の指示>" --mcp-config <json> --strict-mcp-config --allowedTools mcp__kakebo`。手順の全体は mywork の `dev/kakebo_next/docs/2026-10-28_MCPで月次決算をする手順.md`
- ローカルで試す: `supabase start`（config.toml で OAuth Server・DCR は ON）→ アプリを 127.0.0.1:3000 で起動 → `scripts/mcp/demo.ts`（ダミーの10月を入れた利用者とトークンを作る）
