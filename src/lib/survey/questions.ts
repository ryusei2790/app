/**
 * @file lib/survey/questions.ts
 * @description 月1回のアンケート（mywork#1150 第3弾）の固定5問と、回の上限値。
 * 第4弾（動的設問）が入るまでは毎月この5問。1問目は月ごとに比べるため必ず満足度（0〜10）。
 */

export type QuestionKind = "satisfaction" | "fixed" | "followup";

export interface QuestionSeed {
  position: number;
  text: string;
  kind: QuestionKind;
}

export const FIXED_QUESTIONS: QuestionSeed[] = [
  { position: 1, kind: "satisfaction", text: "この1か月、kakebo の満足度を 0〜10 で言うと？　その理由は？" },
  { position: 2, kind: "fixed", text: "一番よく使った機能と、使いにくかったところは？" },
  { position: 3, kind: "fixed", text: "記録をつけ忘れた日はありましたか？　そのとき何があれば続けられましたか？" },
  { position: 4, kind: "fixed", text: "今月の決算（提案）は役に立ちましたか？　どこが良かった／いらなかった？" },
  { position: 5, kind: "fixed", text: "次に欲しい機能、やめてほしいことは？" },
];

/** 1問あたり AI で整える回数の上限（最初の1回＋言い直し3回） */
export const TIDY_LIMIT_PER_QUESTION = 4;
/** 1回の回答の文字数の上限（約60秒の発話で足りる長さ） */
export const ANSWER_MAX_CHARS = 1000;
/** 音声で話せる長さ（秒）。画面で止める */
export const VOICE_MAX_SECONDS = 60;

export const SURVEY_CONSENT =
  "回答はアプリの改善のために運営（社長）が読みます。音声は保存しません（文字にした回答だけを保存します）。";
