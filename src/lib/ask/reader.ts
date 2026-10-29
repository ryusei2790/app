/**
 * @file lib/ask/reader.ts
 * @description 質問文をルールで読み、集計の条件（Reading）にする（mywork#500 第3弾、設計書 4-8・追記 2026-10-29）。
 *
 * - 外部 AI は使わない。決まった言い回し（期間・対象・集計）を正規表現と語彙（本人のカテゴリー名）で読む
 * - 数字はここでは出さない。読むだけ（計算は lib/ask/answer.ts → lib/aggregate の summarize）
 * - 読めないときは推測しない: 何も読めなければ unsupported（例文つき）、カテゴリーが2つ以上に取れれば ambiguous（候補つき）
 * - 続けての質問（「内訳は？」「先月と比べて」）は直前の Reading から、書かれていない軸だけを引き継ぐ
 * 第4弾でクラウドの読み取りを足すときは、同じ Reading を返す別の読み手を作り、ここと突き合わせる。
 */

/** 質問文の長さの上限（長文を正規表現に通さない） */
export const MAX_QUESTION = 200;
/** 期間の上限（月数）。集計で読む行を抑える */
export const MAX_PERIOD_MONTHS = 13;

export interface Reading {
  flow: "expense" | "income";
  /** 月の範囲 "YYYY-MM"（両端を含む）。今月は今日まで（summarize が切る） */
  period: { from: string; to: string; label: string };
  target: { type: "all" | "category" | "fixed" | "variable"; id?: string; name: string };
  measure: "sum" | "count" | "per_day";
  groupBy?: "category" | "month";
  /** 前の同じ長さの期間と比べる */
  compare?: boolean;
}

export interface Vocab {
  /** JST の今日 "YYYY-MM-DD" */
  today: string;
  categories: Array<{ id: string; name: string; type: "income" | "expense" }>;
}

export type ReadResult =
  | { ok: true; reading: Reading }
  | { ok: false; reason: "unsupported"; examples: string[] }
  | { ok: false; reason: "ambiguous"; candidates: string[] };

export const EXAMPLES = ["今月の食費はいくら？", "先月の支出の内訳", "直近3か月の外食を月別で", "今月の外食は何回？", "今月の支出を先月と比べて"];

const unsupported = (): ReadResult => ({ ok: false, reason: "unsupported", examples: EXAMPLES });

/**
 * "YYYY-MM" の n か月後。lib/mcp/tools.ts の addMonths と同じ式（同じ結果になることをテストで確かめる）。
 * MCP 側を import しないのは、あちらが DB の読み込み（prisma）まで連れてきて、画面の部品から使えなくなるため。
 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/**
 * 年の無い「M月」を、今月より後なら去年と読む（来月の実績はまだ無いので、言うのはたいてい去年のこと）。
 */
function monthNoYear(m: number, today: string): string {
  const [ty, tm] = today.split("-").map(Number);
  return ym(m > tm ? ty - 1 : ty, m);
}

/** 期間を読む。読めなければ null（呼ぶ側で直前か今月にする） */
function readPeriod(q: string, today: string): Reading["period"] | null | "invalid" {
  const thisMonth = today.slice(0, 7);
  const [ty] = today.split("-").map(Number);
  const valid = (m: number) => m >= 1 && m <= 12;
  const range = (from: string, to: string, label: string) => {
    if (from > to || monthsBetween(from, to) > MAX_PERIOD_MONTHS) return "invalid" as const;
    return { from, to, label };
  };

  // 1. 範囲「(YYYY年)M月から(YYYY年)N月」
  const r = q.match(/(?:(\d{4})年)?(\d{1,2})月(?:から|〜|~|-)(?:(\d{4})年)?(\d{1,2})月/);
  if (r) {
    const [m1, m2] = [Number(r[2]), Number(r[4])];
    if (!valid(m1) || !valid(m2)) return "invalid";
    const to = r[3] ? ym(Number(r[3]), m2) : r[1] ? ym(Number(r[1]), m2) : monthNoYear(m2, today);
    let from = r[1] ? ym(Number(r[1]), m1) : ym(Number(to.slice(0, 4)), m1);
    if (from > to && !r[1]) from = ym(Number(to.slice(0, 4)) - 1, m1); // 「11月から2月」は年をまたぐ
    return range(from, to, `${monthLabel(from)}〜${monthLabel(to)}`);
  }
  // 2. 直近Nか月
  const n = q.match(/(?:直近|過去|最近)(\d{1,2})(?:か|ヶ|カ|ケ)?月/);
  if (n) {
    const k = Number(n[1]);
    if (k < 1) return "invalid";
    return range(addMonths(thisMonth, -(k - 1)), thisMonth, `直近${k}か月`);
  }
  // 3. 今年・去年
  if (/今年/.test(q)) return { from: ym(ty, 1), to: thisMonth, label: "今年" };
  if (/去年|昨年/.test(q)) return { from: ym(ty - 1, 1), to: ym(ty - 1, 12), label: "去年" };
  // 4. 先々月・先月・今月（先々月を先に）
  if (/先々月/.test(q)) return { from: addMonths(thisMonth, -2), to: addMonths(thisMonth, -2), label: "先々月" };
  if (/先月|前月/.test(q)) return { from: addMonths(thisMonth, -1), to: addMonths(thisMonth, -1), label: "先月" };
  if (/今月/.test(q)) return { from: thisMonth, to: thisMonth, label: "今月" };
  // 5. YYYY年M月・M月
  const y = q.match(/(\d{4})年(\d{1,2})月/);
  if (y) {
    if (!valid(Number(y[2]))) return "invalid";
    const m = ym(Number(y[1]), Number(y[2]));
    return { from: m, to: m, label: monthLabel(m) };
  }
  const m = q.match(/(\d{1,2})月/);
  if (m) {
    if (!valid(Number(m[1]))) return "invalid";
    const mm = monthNoYear(Number(m[1]), today);
    return { from: mm, to: mm, label: monthLabel(mm) };
  }
  return null;
}

/**
 * カテゴリー名を探す。
 * 1. 名前（と「〜費」のゆれ: 交通費↔交通、外食↔外食費）が文の中にあるか。2文字未満の語幹は使わない（「食」で食費を拾わない）
 * 2. 当たった範囲がほかの当たりの中に収まるものは捨てる（「外食費」の中の「食費」、「サブスク（仕事）」の中の「サブスク」）
 * 3. それでも無ければ、助詞で区切った語が名前の頭に当たるものを候補にする（「サブ」→ サブスク…）
 * 2つ以上残れば推測せず ambiguous。
 */
function readCategory(q: string, cats: Vocab["categories"]): { hit?: Vocab["categories"][number]; candidates?: string[] } {
  type Hit = { cat: Vocab["categories"][number]; start: number; end: number };
  const hits: Hit[] = [];
  for (const c of cats) {
    const name = c.name.normalize("NFKC");
    const stem = name.endsWith("費") ? name.slice(0, -1) : name;
    const forms = [name + (name.endsWith("費") ? "" : "費"), name, ...(stem.length >= 2 ? [stem] : [])];
    for (const f of forms) {
      const i = q.indexOf(f);
      if (i >= 0) {
        hits.push({ cat: c, start: i, end: i + f.length });
        break; // 長い形から順に試すので、最初に当たったものがその名前のいちばん長い当たり
      }
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && h.end <= o.end && o.end - o.start > h.end - h.start));
  const unique = [...new Map(kept.map((h) => [h.cat.id, h])).values()];
  if (unique.length === 1) return { hit: unique[0].cat };
  if (unique.length > 1) return { candidates: unique.map((h) => h.cat.name) };

  const words = q.split(/[のはをがでとにもへ、。？?！!\s]+/).filter((w) => w.length >= 2);
  const prefix = cats.filter((c) => words.some((w) => c.name.normalize("NFKC").startsWith(w)));
  if (prefix.length === 1) return { hit: prefix[0] };
  if (prefix.length > 1) return { candidates: prefix.map((c) => c.name) };
  return {};
}

/**
 * 質問を読む。
 * @param previous 直前の読み。続けての質問で、書かれていない軸（期間・対象・向き・集計）をここから引き継ぐ
 */
export function readQuestion(question: string, vocab: Vocab, previous?: Reading): ReadResult {
  if (question.length > MAX_QUESTION) return unsupported();
  // 全角数字・記号をそろえる（「１１月」「１日あたり」）
  let q = question.normalize("NFKC").trim();
  if (!q) return unsupported();

  // 1. 比較（「先月と比べて」）。期間の読みに「先月」を拾わせないよう、先に文から外す
  let compare = false;
  q = q.replace(/(?:先々月|先月|前月|前の月|去年|昨年|前の期間|前)と(?:比べ|比較)(?:て|る|ると|たら)?/g, () => {
    compare = true;
    return " ";
  });
  if (/比べて|比較/.test(q)) compare = true;

  // 2. 期間
  const period = readPeriod(q, vocab.today);
  if (period === "invalid") return unsupported();

  // 3. 集計・まとめ方
  const measure: Reading["measure"] | null = /何回|何件|件数|回数/.test(q)
    ? "count"
    : /(?:1|一)日(?:あたり|当たり|平均)|日割り/.test(q)
      ? "per_day"
      : null;
  const groupBy: Reading["groupBy"] = /月別|月ごと|推移/.test(q) ? "month" : /内訳|カテゴリー?別/.test(q) ? "category" : undefined;

  // 4. 対象と向き
  let target: Reading["target"] | null = null;
  let flow: Reading["flow"] | null = null;
  if (/固定/.test(q)) target = { type: "fixed", name: "固定費" };
  else if (/変動/.test(q)) target = { type: "variable", name: "変動費" };
  else {
    const c = readCategory(q, vocab.categories);
    if (c.candidates) return { ok: false, reason: "ambiguous", candidates: c.candidates };
    if (c.hit) {
      target = { type: "category", id: c.hit.id, name: c.hit.name };
      flow = c.hit.type;
    }
  }
  if (!flow && /収入|稼い|入った|給料|入金/.test(q)) flow = "income";
  if (!target && flow === "income") target = { type: "all", name: "収入全体" };
  const moneyWord = /支出|使っ|使い|使う|いくら|合計|円|出費|お金/.test(q);
  if (!target && moneyWord) {
    target = { type: "all", name: "支出全体" };
    flow = "expense";
  }

  // 5. 何も読めなければ数字を出さない。続けての質問は「まとめ方」か「比較」か「期間」だけでもよい
  const followUp = groupBy !== undefined || compare || period !== null || measure !== null;
  if (!target && !(followUp && (previous || groupBy || compare))) return unsupported();

  const thisMonth = vocab.today.slice(0, 7);
  const reading: Reading = {
    flow: flow ?? (target ? "expense" : previous?.flow ?? "expense"),
    period: period ?? previous?.period ?? { from: thisMonth, to: thisMonth, label: "今月" },
    target: target ?? previous?.target ?? { type: "all", name: "支出全体" },
    measure: measure ?? (target ? "sum" : previous?.measure ?? "sum"),
  };
  if (groupBy) reading.groupBy = groupBy;
  if (compare) reading.compare = true;
  return { ok: true, reading };
}
