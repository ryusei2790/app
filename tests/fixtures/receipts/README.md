# レシート読み取りのモック用 JSON

AI（Gemini / Haiku / GLM）が返す想定の JSON。テストとローカル開発（`RECEIPT_PARSER=mock`）で使う。
実在のレシートの内容は入れない（公開リポのため）。店名・品目は架空の例。

- `normal.json` … 正常（合計 598 円 = 品目の和）
- `exclusive-tax.json` … 外税のスーパー（明細は税抜・税の行は tax_lines、数量×単価の行・値引き行・軽減税率と10%の混在。合計 1,327 円 = 明細の和 1,222 ＋ 税 105）。mywork#229
