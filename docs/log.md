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

## 2026-11-01 定期バックアップが Drive の一覧で止まる（mywork#1031）
- 何を: 11/1 10:00 の launchd 実行が、暗号化ファイルを書いた後の readdir で11時間止まり、ok 行が出ず監視が失敗と判定した。一覧を ls の子プロセス＋30秒の時間制限に変えた
- なぜ: launchd からの Drive の open(2) は EPERM（#839）だけでなく返らないことがある。node の readdir はスレッドプールで止まるので中からは切れない
- 結果: 時間切れ・拒否は整理だけ飛ばして ok:true で終わる

## 2026-11-01 tsx の固定と台帳での整理（mywork#1033）
- 何を: tsx を devDependencies に完全固定し run.sh は node_modules/.bin/tsx を直接呼ぶ。古いファイルは台帳 ~/.config/kakebo-backup/written.txt と rm（時間制限つき）で消す
- なぜ: npx は未固定の版を取得しうるので DATABASE_URL 入りの環境で使わない。launchd の一時ジョブで試すと Drive への書き込みと rm は成功し ls だけ返らなかった。TCC で bash や node に権限を与えると範囲が広いので台帳にした
- 結果: 一覧が取れないときも整理が動く。削除の失敗はログの deleteFailed に出し、バックアップは成功扱い

## 2026-11-05 標準3つ＋拡張機能（mywork#1150 第1弾）
- 何を: catalog.ts を「標準3つ（手入力 /entry・レシート・今月の決算 /closing）＋常設（チャット・設定）＋拡張機能」に。カレンダー・収支一覧は拡張機能へ。ホーム /start（大きいボタン3つ＋拡張機能＋右下チャット）、拡張機能の ON/OFF・並べ替え画面 /extensions（PUT /api/v1/menu を流用）、ログイン後・PWA の起動先を /start に。migration で既存ユーザーに home・transactions を先頭に入れる
- なぜ: 本人「メニューがぐちゃぐちゃ。標準は3つだけ、他は消さずに拡張機能」。設計 Q1〜Q8 は本人「全部推し」（#1150）
- 結果: 決算は場所だけ（提案ボットは第2弾）。機能は1つも消していない（OFF でも URL・API・cron は動く）
