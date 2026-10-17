-- =============================================================================
-- 20261016000000_import_undo.sql — 取り込みの取り消し（mywork#425 第2弾、テスト X5）
-- 役割: csv_imports.status に 'undone'（取り消し済み）を足す。
--   取り消すと、その取り込みで作った取引は物理削除し（行の目印も消えるので同じ CSV を入れ直せる）、
--   履歴の行は件数・ファイル名を残したまま status = 'undone' にする（いつ何を入れて取り消したかが残る）。
-- 列を足さない・既存の行の値を変えないので、新しいコードが本番に出る前に当てても今の動きは変わらない。
-- =============================================================================

ALTER TABLE csv_imports DROP CONSTRAINT IF EXISTS csv_imports_status_check;
ALTER TABLE csv_imports
  ADD CONSTRAINT csv_imports_status_check CHECK (status IN ('pending', 'success', 'error', 'undone'));
