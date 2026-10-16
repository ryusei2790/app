# 実データの回帰テスト（V2、mywork#425 第1弾）

本物の帳簿（CSV。`biz/accounting/data/…`、git の外）で、月ごとの集計（支出・収入・返金・振替・予定・固定／変動・費目）が
前回と **1円単位で一致**するかを確かめる。金額は git に入れないので、ここにあるのは正規化した集計の **SHA-256 と件数だけ**。

- `expected.json` … ハッシュ・月数・行数・基準日（today）・作った日・定義の版。**金額は入っていない**
- 正規化した集計の本体は `.regression/expected.json`（`.gitignore`）。不一致のときに「どの月・どの項目が違うか」を見る
- テスト本体: `tests/unit/regression-real-data.test.ts`（`KAKEBO_REGRESSION_CSV` が無ければ skip。CI では skip）

```bash
# 回す（CSV のパスを渡す。リポにコピーしない）
KAKEBO_REGRESSION_CSV=/path/to/export.csv npx vitest run --project unit tests/unit/regression-real-data.test.ts
# 定義を変えたときに期待値を作り直す（経理部 budget.md と突き合わせてから）
KAKEBO_REGRESSION_WRITE=1 KAKEBO_REGRESSION_CSV=/path/to/export.csv npx vitest run --project unit tests/unit/regression-real-data.test.ts
```

基準日（today）は `expected.json` に保存し、次回も同じ日で計算する（「今月は今日まで」の月が日ごとに変わらないように）。
