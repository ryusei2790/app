/**
 * @file lib/closing/bot.ts
 * @description 決算日の提案ボット（mywork#1150 第2弾）。月の集計（summarize の結果）を Claude Sonnet 5.5 に渡し、
 * 「今月の目標達成・次の月の目標・配分・気をつける点・使いすぎ注意」を Markdown で返してもらう。
 *
 * 設計意図:
 * - 数字の計算は AI にさせない。合計・前月比・割合はここで計算して渡し、AI は文章にするだけ（数字の作り話を防ぐ）
 * - AI に渡すのは集計だけ（カテゴリー名と合計・件数）。取引のメモ・店名・日付ごとの明細は渡さない
 * - AI の呼び出し口は lib/menu/chat.ts の getCreateMessage を使い回す（テストでモックに差し替えられる）
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { MonthlySummary } from "@/lib/aggregate/monthly";
import { toAnthropicModelId } from "@/lib/receipt/providers";
import type { CreateMessage } from "@/lib/menu/chat";

/** 決算日（1〜28）。null は月末 */
export type ClosingDay = number | null;

/** 決算日の値として正しいか（29〜31日は月によって無いので受けない） */
export function isClosingDay(v: unknown): v is ClosingDay {
  return v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 28);
}

/** "YYYY-MM" の前の月 */
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** "YYYY-MM" の次の月 */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** その月の決算日 "YYYY-MM-DD"（null＝月末） */
export function closingDateOf(month: string, day: ClosingDay): string {
  if (day !== null) return `${month}-${String(day).padStart(2, "0")}`;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/**
 * 今日（JST）が決算日以降か。決算日より前でも作れるが、画面で「まだ途中の数字です」と出すのに使う。
 */
export function isAfterClosing(today: string, month: string, day: ClosingDay): boolean {
  return today >= closingDateOf(month, day);
}

/** AI に渡す集計（明細なし）。テストでメモ・店名が混ざらないことを確かめる */
export interface ClosingFacts {
  month: string;
  today: string;
  inProgress: boolean;
  expense: number;
  income: number;
  balance: number;
  fixedExpense: number;
  variableExpense: number;
  /** 前月の支出（前月の取引が無ければ null） */
  prevExpense: number | null;
  prevIncome: number | null;
  categories: Array<{ name: string; amount: number; count: number; ratio: number; prevAmount: number | null; diff: number | null }>;
  /** 予定（今日より後の取引） */
  scheduledExpense: number;
  scheduledIncome: number;
  /** この月の支出の目標（円。決めていなければ null。mywork#1238） */
  goal: number | null;
  /** 目標 − 支出（プラスなら目標内。目標が無ければ null）。AI に引き算させないためここで計算する */
  goalLeft: number | null;
  /** 次の月の呼び方（「今月」「来月」「2026年8月」）。さかのぼって決算すると次の月は「今月」になる */
  nextLabel: string;
}

/** 集計から AI に渡す事実だけを取り出す（計算はここで済ませる） */
export function buildFacts(
  cur: MonthlySummary,
  prev: MonthlySummary | null,
  inProgress: boolean,
  extra: { goal?: number | null; nextLabel?: string } = {}
): ClosingFacts {
  const goal = extra.goal ?? null;
  const prevHasData = prev !== null && (prev.expense.purchaseCount > 0 || prev.income.count > 0);
  const prevByName = new Map(prevHasData ? prev!.byCategory.map((c) => [c.name, c.amount]) : []);
  return {
    month: cur.month,
    today: cur.today,
    inProgress,
    expense: cur.expense.total,
    income: cur.income.total,
    balance: cur.balance,
    fixedExpense: cur.fixed.fixedExpense,
    variableExpense: cur.fixed.variableExpense,
    prevExpense: prevHasData ? prev!.expense.total : null,
    prevIncome: prevHasData ? prev!.income.total : null,
    categories: cur.byCategory.slice(0, 15).map((c) => {
      const p = prevHasData ? (prevByName.get(c.name) ?? 0) : null;
      return { name: c.name, amount: c.amount, count: c.count, ratio: c.ratio, prevAmount: p, diff: p === null ? null : c.amount - p };
    }),
    scheduledExpense: cur.scheduled.expense,
    scheduledIncome: cur.scheduled.income,
    goal,
    goalLeft: goal === null ? null : goal - cur.expense.total,
    nextLabel: extra.nextLabel ?? "来月",
  };
}

/**
 * AI への指示。見出しの「〇〇の目標」は次の月の呼び方に合わせる（さかのぼって先月を決算すると「今月の目標」。mywork#1238）
 */
export function closingSystemPrompt(nextLabel = "来月"): string {
  return [
    "あなたは家計簿アプリ「カレンダー家計簿」の決算係です。月の締めに、本人へ短く具体的な提案を日本語で書きます。",
    "数字は渡された JSON の値だけを使い、新しい数字を計算・推測して作らないでください（目標額を出すときは「〇〇円くらい」と渡された値からの丸めにとどめる）。",
    "出力は Markdown だけ。次の見出しをこの順で必ず使います:",
    `## この月のまとめ / ## 目標の達成ぐあい / ## ${nextLabel}の目標 / ## 配分の提案 / ## 気をつける点 / ## 使いすぎ注意`,
    "各見出しの下は箇条書き2〜4行。全体で800字以内。表は使ってよい。HTML・リンク・画像は書かない。",
    "前月の値が null なら比べず、「次の月から比べられます」とだけ書く。inProgress が true なら、まだ月の途中の数字だと最初に一言添える。",
    "goal が null でなければ「目標の達成ぐあい」で goal と expense を比べる（差は goalLeft の値をそのまま使う。プラスなら目標内）。goal が null なら「この月の目標はありませんでした。下の『目標を決める』で次の月の目標を決められます」と書く。",
    "責めない・やさしい口調で、できたことを先に書く。投資や借入の勧誘はしない。",
  ].join("\n");
}

export interface ClosingResult {
  markdown: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** AI に提案を書いてもらう。文字が返らなければ例外（route が 503 にする） */
export async function runClosingBot(opts: { facts: ClosingFacts; create: CreateMessage; model?: string }): Promise<ClosingResult> {
  const model = toAnthropicModelId(opts.model);
  const res: Anthropic.Message = await opts.create({
    model,
    max_tokens: 1500,
    system: closingSystemPrompt(opts.facts.nextLabel),
    messages: [
      {
        role: "user",
        content: `次の月 ${nextMonth(opts.facts.month)}（${opts.facts.nextLabel}）に向けて、${opts.facts.month} の決算の提案を書いてください。金額の単位は円です。\n\n\`\`\`json\n${JSON.stringify(opts.facts, null, 2)}\n\`\`\``,
      },
    ],
  });
  const markdown = sanitizeMarkdown(
    res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
  );
  if (!markdown) throw new Error("AI の返事が空でした");
  return { markdown, model, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
}

/**
 * 保存前の後始末。画面は react-markdown（生 HTML は描かない）で表示するので XSS にはならないが、
 * 念のため HTML タグと、```markdown で囲まれて返ってきたときの囲みを外し、長さを DB の上限に収める。
 */
export function sanitizeMarkdown(text: string): string {
  let t = text.trim();
  const fenced = t.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenced) t = fenced[1].trim();
  t = t.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  return t.slice(0, 20000);
}
