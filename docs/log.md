- 2026-10-21 dev-12: NEXT_PUBLIC_GOOGLE_CLIENT_ID を Vercel に追加（本番・Preview）

## 2026-10-25 dev-14: 週1の定期バックアップ（mywork#764 ②）
- 何を: `src/lib/backup/weekly.ts`（ファイル名・age 暗号化/復号・間引き）、`scripts/backup/`（weekly-backup.ts・restore-drill.ts・run.sh・check-fresh.sh・setup.sh）、テスト `tests/unit/backup.test.ts`・`tests/db/backup.test.ts`
- なぜ: 設計書（kakebo_next/docs/2026-10-24_定期バックアップ_設計.md）の決定 A（Mac launchd 週1＋Google Drive・age・直近8週＋月初12か月）
- 決めたこと: 暗号化は npm の age-encryption（age CLI と同じ形式。brew の age を入れなくても動く）。8日監視は gh-local-bridge を書き換えず、毎日 12:00 の launchd（check-fresh.sh）にした（bridge.sh は他セッションの未コミット変更があり、同じ PR に入れられないため）。復元テストの一致判定は件数（共通カテゴリーの id は DB ごとに違うので、本番のファイルではハッシュは一致しなくてよい）

## 2026-10-25 dev-8: 運用手順書（mywork#764 ⑤）
- 何を: docs/procedures.md（デプロイ・migration・鍵の更新・費用の上限・バックアップ/監視の確認と復元・困ったとき）
- なぜ: 本番の手順が kakebo_next/docs と README に散らばっていたので、app リポの中に1か所にまとめた

## 2026-10-25 dev-8: 更新履歴とデータの持ち方（mywork#764 ⑥）
- 何を: /about/changes（lib/changes/history.ts）、メニューと about ヘッダに導線、テスト C1〜C3
- なぜ: 本番アプリとして何が変わったか・データをどこに置きどう消せるかを本人が読めるように

## 2026-10-29 第3弾 質問して集計（mywork#500、dev-3）
- /ask と POST /api/v1/ask を追加。質問はルールで読み（lib/ask/reader.ts）、数字は summarize（画面・MCP と同じ）で出す。外部 AI は使わない
- スマホ幅の通し操作で直した点: 横の余白・入力欄の位置・送信中の表示・文と棒の重複・期間を変えたら比較を外す・1カテゴリーの内訳は月別

## 2026-10-31 Stripe 計画照合とテスト決済（mywork#970）
- 計画との照合結果は docs/2026-10-31_Stripe計画とPR31照合.md。past_due の二重課金を修正、最終確認の表示を追加
- サンドボックスで実決済→実 API の Webhook 処理→Portal→解約まで確認（ローカル Supabase、Webhook は署名をローカルで作成。Stripe からの実配信は未確認）
