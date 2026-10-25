- 2026-10-21 dev-12: NEXT_PUBLIC_GOOGLE_CLIENT_ID を Vercel に追加（本番・Preview）

## 2026-10-25 dev-14: 週1の定期バックアップ（mywork#764 ②）
- 何を: `src/lib/backup/weekly.ts`（ファイル名・age 暗号化/復号・間引き）、`scripts/backup/`（weekly-backup.ts・restore-drill.ts・run.sh・check-fresh.sh・setup.sh）、テスト `tests/unit/backup.test.ts`・`tests/db/backup.test.ts`
- なぜ: 設計書（kakebo_next/docs/2026-10-24_定期バックアップ_設計.md）の決定 A（Mac launchd 週1＋Google Drive・age・直近8週＋月初12か月）
- 決めたこと: 暗号化は npm の age-encryption（age CLI と同じ形式。brew の age を入れなくても動く）。8日監視は gh-local-bridge を書き換えず、毎日 12:00 の launchd（check-fresh.sh）にした（bridge.sh は他セッションの未コミット変更があり、同じ PR に入れられないため）。復元テストの一致判定は件数（共通カテゴリーの id は DB ごとに違うので、本番のファイルではハッシュは一致しなくてよい）

## 2026-10-25 dev-8: 更新履歴とデータの持ち方（mywork#764 ⑥）
- 何を: /about/changes（lib/changes/history.ts）、メニューと about ヘッダに導線、テスト C1〜C3
- なぜ: 本番アプリとして何が変わったか・データをどこに置きどう消せるかを本人が読めるように
