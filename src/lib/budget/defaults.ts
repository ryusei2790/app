/**
 * @file lib/budget/defaults.ts
 * @description 予算の8費目と、CSV のカテゴリー → 費目の初期の対応表（設計書「仮に決めたこと」3）。
 *
 * 出典は経理部の予算台帳 biz/accounting/data/budget.md:
 *   - 枠: 可処分 60,000円/月（食費 20,000・目標 15,000 / サブスク 2,000 / 日用品 3,000 / 移動 5,000 /
 *         先取り貯蓄 10,000 / 自己投資 4,000 / 自由費 13,000 / 予備 3,000）
 *   - 当てはめ: 食費・お菓子→食費／日用品→日用品／交通費→移動／外食費・趣味・衣服・交際費・その他→自由費／
 *         メモが apple・Amazonプライム・google one・Spotify・アップルストア→サブスク／家賃・事業→枠の外
 *   - budget.md に無い「本」は自己投資、「光熱費」は家賃と同じく枠の外にした
 * 本人が画面で直せるので、ここは最初の1回だけ使う（lib/budget/seed.ts）。
 */

export interface DefaultFrame {
  name: string;
  monthlyLimit: number;
  /** 目標（上限とは別に「ここまでに抑えたい」額）。食費だけ */
  target: number | null;
}

export const DEFAULT_FRAMES: DefaultFrame[] = [
  { name: "食費", monthlyLimit: 20000, target: 15000 },
  { name: "サブスク", monthlyLimit: 2000, target: null },
  { name: "日用品", monthlyLimit: 3000, target: null },
  { name: "移動", monthlyLimit: 5000, target: null },
  { name: "先取り貯蓄", monthlyLimit: 10000, target: null },
  { name: "自己投資", monthlyLimit: 4000, target: null },
  { name: "自由費", monthlyLimit: 13000, target: null },
  { name: "予備", monthlyLimit: 3000, target: null },
];

/** 食費の1日目安を出す費目の名前 */
export const FOOD_FRAME_NAME = "食費";

/**
 * 初期の対応表。上から順に priority を振る（メモの語句ルールはカテゴリーより必ず先に見る: classify.ts）。
 * frame: null は「枠の外」（6万円の対象外）。カテゴリーは支出のカテゴリー。
 */
export type DefaultRule =
  | { memoKeyword: string; frame: string }
  | { categoryName: string; frame: string | null };

export const DEFAULT_RULES: DefaultRule[] = [
  { memoKeyword: "apple", frame: "サブスク" },
  { memoKeyword: "Amazonプライム", frame: "サブスク" },
  { memoKeyword: "google one", frame: "サブスク" },
  { memoKeyword: "Spotify", frame: "サブスク" },
  { memoKeyword: "アップルストア", frame: "サブスク" },
  { categoryName: "食費", frame: "食費" },
  { categoryName: "お菓子", frame: "食費" },
  { categoryName: "日用品", frame: "日用品" },
  { categoryName: "交通費", frame: "移動" },
  { categoryName: "外食費", frame: "自由費" },
  { categoryName: "趣味", frame: "自由費" },
  { categoryName: "衣服", frame: "自由費" },
  { categoryName: "交際費", frame: "自由費" },
  { categoryName: "その他", frame: "自由費" },
  { categoryName: "本", frame: "自己投資" },
  { categoryName: "家賃", frame: null },
  { categoryName: "事業", frame: null },
  { categoryName: "光熱費", frame: null },
];
