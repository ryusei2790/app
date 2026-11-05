-- =============================================================================
-- 20261105000000_standard_menu.sql — 標準3つ＋拡張機能（mywork#1150 第1弾）
-- 標準機能はコード側（catalog.ts の standard）で固定し DB には入れない。
-- 今まで固定だったカレンダー（home）と収支一覧（transactions）は拡張機能になるので、
-- 既存の利用者には先頭に入れて見た目の変化を小さくする（本人アカウントは拡張機能の画面で本人が選び直す: Q3 A）。
-- 新規の利用者には入れない（ホームは標準3つ: Q2 A）。表・RLS の変更はない。
-- =============================================================================

INSERT INTO user_layout (user_id, feature_id, position)
SELECT u.id, f.feature_id, f.position
FROM auth.users u
CROSS JOIN (VALUES ('home', -2), ('transactions', -1)) AS f(feature_id, position)
ON CONFLICT (user_id, feature_id) DO NOTHING;
