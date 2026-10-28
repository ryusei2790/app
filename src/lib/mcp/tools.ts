/**
 * @file lib/mcp/tools.ts
 * @description AI エージェントに見せる道具の中身（mywork#882、設計書 4節）。MCP の決まりごとから切り離した普通の関数。
 *
 * 道具は7つ（本人決定 Q2=A: 書くのは「支出の追加」と「AI が直前に足した1件の取り消し」だけ）:
 *   書く: addExpense（支出を1件）・undoLastAdded（AI が直前に足した1件を消す）
 *   読む: monthlySummary・categorySummary・listFixedCosts・listCategories・listRecent
 * 編集・削除・取り込み・全削除・予算台帳（社長だけの機能）は出さない。間違いは画面で直してもらう。
 *
 * どれも withUserDb（RLS が効く）の中の db と、トークンで確かめた userId だけで動く。
 * userId を AI の入力から取ることは無い（＝他人の家計簿を指定する手段が無い）。
 * 数字は画面と同じ lib/aggregate の定義（支出＝購入−返金、振替・借入は除く）を使い、AI と画面で数字をずらさない。
 * 失敗は例外ではなく { ok: false, message }（日本語）で返し、AI が利用者にそのまま伝えられるようにする。
 */

import type { UserDb } from "@/lib/db";
import { dateOnlyToDb, dbToDateOnly } from "@/lib/date/jst";
import { conditionFromRecord, nextDueDate } from "@/lib/fixed-costs/expand";
import { addDays, monthlyEquivalent, type Cycle } from "@/lib/fixed-costs/schedule";
import { loadMonthlySummary, loadTxsBetween } from "@/lib/aggregate/load";
import { monthEnd, summarize } from "@/lib/aggregate/monthly";
import { parseDateOnly, parseYenAmount } from "@/lib/validation/transaction";

/** AI が足した取引の source（DB の CHECK に元からある 'api' を使う。画面では「AI」の印） */
export const MCP_SOURCE = "api";
/** 取り消せるのは、AI が足してからこの時間以内の1件だけ */
export const UNDO_WINDOW_HOURS = 24;
/** 口座が1つも無い人が AI から初めて記録したときに作る口座 */
export const DEFAULT_ACCOUNT_NAME = "現金";
/** メモの長さの上限（AI の長文がそのまま入らないように） */
export const MAX_NOTE = 200;
/** 未来の日付は1年先まで（予定の支払いは入れられるが、年の打ち間違いは止める） */
export const MAX_FUTURE_DAYS = 366;
/** category_summary の最大の月数 */
export const MAX_MONTHS = 12;
/** list_recent の件数の上限（月の決算で1か月分を一度に読めるよう 200） */
export const MAX_RECENT = 200;

export type ToolResult<T> = { ok: true; data: T; text: string } | { ok: false; message: string };

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const fail = (message: string) => ({ ok: false as const, message });

// ─── 名前のあいまい一致（カテゴリ・口座） ─────────────────────────────────────

/** 比べる前に揃える（全角半角・大文字小文字・前後の空白） */
export function normalizeName(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}

export type NameMatch<T> = { ok: true; item: T } | { ok: false; candidates: string[] };

/**
 * 名前で1つに決める。完全一致 → 部分一致（どちらかがどちらかを含む）の順。
 * 複数当たれば決めずに候補を返す（AI に利用者へ聞き直させる。勝手に選んで間違ったカテゴリに入れない）。
 * 同じ名前が自分のものと共通のものにあれば、自分のもの（preferred）を優先する。
 */
export function matchByName<T extends { name: string }>(items: T[], query: string, preferred?: (t: T) => boolean): NameMatch<T> {
  const q = normalizeName(query);
  if (!q) return { ok: false, candidates: items.map((i) => i.name) };
  const pick = (found: T[]): NameMatch<T> | null => {
    if (found.length === 1) return { ok: true, item: found[0] };
    if (found.length > 1 && preferred) {
      const mine = found.filter(preferred);
      if (mine.length === 1) return { ok: true, item: mine[0] };
    }
    return found.length > 1 ? { ok: false, candidates: [...new Set(found.map((i) => i.name))] } : null;
  };
  const exact = pick(items.filter((i) => normalizeName(i.name) === q));
  if (exact) return exact;
  const partial = pick(items.filter((i) => {
    const n = normalizeName(i.name);
    return n.includes(q) || q.includes(n);
  }));
  if (partial) return partial;
  return { ok: false, candidates: [...new Set(items.map((i) => i.name))] };
}

// ─── 書く: 支出を1件 ─────────────────────────────────────────────────────────

export interface AddExpenseInput {
  amount: unknown;
  category?: string;
  date?: string;
  note?: string;
  account?: string;
}

export async function addExpense(db: UserDb, userId: string, input: AddExpenseInput, today: string) {
  // 1. 入力の検証（画面の手入力と同じ規則 lib/validation を共用）
  const amount = parseYenAmount(input.amount);
  if (!amount.ok) return fail(amount.message);
  const dateStr = input.date === undefined || input.date === "" ? today : input.date;
  const date = parseDateOnly(dateStr);
  if (!date.ok) return fail(date.message);
  if (date.value > addDays(today, MAX_FUTURE_DAYS)) return fail("日付が1年以上先です。年を確かめてください");
  const note = input.note?.trim() || null;
  if (note && note.length > MAX_NOTE) return fail(`メモは${MAX_NOTE}文字までにしてください`);

  // 2. カテゴリ（支出のもの・共通＋自分）。指定が無ければ未分類
  let category: { id: string; name: string } | null = null;
  if (input.category && input.category.trim()) {
    const cats = await db.category.findMany({
      where: { type: "expense", OR: [{ userId: null }, { userId }] },
      select: { id: true, name: true, userId: true },
      orderBy: { createdAt: "asc" },
    });
    const m = matchByName(cats, input.category, (c) => c.userId === userId);
    if (!m.ok) {
      return fail(`カテゴリ「${input.category}」を1つに決められませんでした。次から選んでください: ${m.candidates.join("、")}（記録はしていません）`);
    }
    category = { id: m.item.id, name: m.item.name };
  }

  // 3. 口座。指定があれば名前で、無ければ最初に作った口座。1つも無ければ「現金」を作る（AI だけで使い始められるように）
  const accounts = await db.account.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  let account: { id: string; name: string };
  if (input.account && input.account.trim()) {
    const m = matchByName(accounts, input.account);
    if (!m.ok) {
      return fail(`口座「${input.account}」が見つかりません。次から選んでください: ${m.candidates.join("、") || "（口座がまだありません）"}（記録はしていません）`);
    }
    account = m.item;
  } else if (accounts.length > 0) {
    account = accounts[0];
  } else {
    account = await db.account.create({ data: { userId, name: DEFAULT_ACCOUNT_NAME, type: "cash" }, select: { id: true, name: true } });
  }

  // 4. 記録（source='api'。取り消しはこの印のある行だけが対象）
  const tx = await db.transaction.create({
    data: {
      userId,
      accountId: account.id,
      categoryId: category?.id ?? null,
      amount: amount.value,
      type: "expense",
      kind: "normal",
      transactionDate: dateOnlyToDb(date.value),
      note,
      source: MCP_SOURCE,
    },
    select: { id: true },
  });

  const data = {
    id: tx.id,
    date: date.value,
    amount: amount.value,
    category: category?.name ?? "未分類",
    account: account.name,
    note,
    scheduled: date.value > today,
  };
  const text =
    `${data.date} に ${yen(data.amount)}（${data.category}・${data.account}${note ? `・${note}` : ""}）を記録しました。` +
    (data.scheduled ? "未来の日付なので、その日までは「予定」として扱います。" : "") +
    `間違いなら undo_last_added で取り消せます（${UNDO_WINDOW_HOURS}時間以内）。`;
  return { ok: true as const, data, text };
}

// ─── 書く: AI が直前に足した1件を取り消す ─────────────────────────────────────

/**
 * AI（source='api'）が足した、消していない取引のうち最も新しい1件を論理削除する（画面の削除と同じ deleted_at）。
 * - 対象は UNDO_WINDOW_HOURS 以内に足したものだけ。古いもの・画面や CSV で入れたものは消せない
 * - expectedId を渡したら、それが「直前の1件」と一致するときだけ消す（AI の取り違え防止）
 */
export async function undoLastAdded(db: UserDb, userId: string, expectedId: string | undefined, now: Date = new Date()) {
  const since = new Date(now.getTime() - UNDO_WINDOW_HOURS * 3600_000);
  const last = await db.transaction.findFirst({
    where: { userId, source: MCP_SOURCE, deletedAt: null, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true, amount: true, transactionDate: true, note: true, category: { select: { name: true } } },
  });
  if (!last) return fail(`取り消せる記録がありません（AI が${UNDO_WINDOW_HOURS}時間以内に足したものだけ取り消せます。それ以外は家計簿の画面で直してください）`);
  if (expectedId && expectedId !== last.id) {
    return fail("指定された記録は「AI が直前に足した1件」ではないので取り消していません。直前の1件だけ取り消せます");
  }
  await db.transaction.update({ where: { id: last.id }, data: { deletedAt: now } });
  const data = {
    id: last.id,
    date: dbToDateOnly(last.transactionDate),
    amount: Number(last.amount),
    category: last.category?.name ?? "未分類",
    note: last.note,
  };
  return { ok: true as const, data, text: `${data.date} の ${yen(data.amount)}（${data.category}）を取り消しました。` };
}

// ─── 読む ───────────────────────────────────────────────────────────────────

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" を確かめる。省略は今月 */
export function parseMonth(v: string | undefined, today: string): string | null {
  if (v === undefined || v === "") return today.slice(0, 7);
  return MONTH_RE.test(v) ? v : null;
}

/** "YYYY-MM" の n か月後 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** 月の集計（画面のダッシュボード・/api/v1/summary と同じ数字）。予算の費目（社長だけの機能）は出さない */
export async function monthlySummary(db: UserDb, userId: string, monthArg: string | undefined, today: string) {
  const month = parseMonth(monthArg, today);
  if (!month) return fail("month は YYYY-MM（例: 2026-10）で指定してください");
  const { summary: s, upcoming } = await loadMonthlySummary(db, userId, month, { today, owner: false });
  const data = {
    month: s.month,
    period: { start: s.period.start, end: s.period.end, status: s.period.status },
    definitions: "支出＝購入−返金（振替・借入・返済は除く）。今日より後の日付は予定として別枠。定義は /about/definitions",
    income: s.income,
    expense: s.expense,
    balance: s.balance,
    fixed_vs_variable: s.fixed,
    by_category: s.byCategory.map((c) => ({ name: c.name, amount: c.amount, purchases: c.purchases, refunds: c.refunds, count: c.count, ratio: c.ratio })),
    transfers: s.transfers,
    loans: s.loans,
    scheduled: { expense: s.scheduled.expense, income: s.scheduled.income, count: s.scheduled.count },
    upcoming_fixed: upcoming.map((u) => ({ date: u.date, name: u.name, type: u.type, amount: u.amount })),
    needs_review: s.review,
  };
  const top = data.by_category.slice(0, 3).map((c) => `${c.name} ${yen(c.amount)}`).join("、");
  const text =
    `${month}（${s.period.start}〜${s.period.end}）: 収入 ${yen(s.income.total)}・支出 ${yen(s.expense.total)}・差額 ${yen(s.balance)}。` +
    (top ? `支出の多いカテゴリ: ${top}。` : "") +
    (s.review.unassigned > 0 ? `未分類が${s.review.unassigned}件あります。` : "");
  return { ok: true as const, data, text };
}

/** 期間（最大12か月）×カテゴリの月別推移 */
export async function categorySummary(db: UserDb, userId: string, fromArg: string | undefined, toArg: string | undefined, today: string) {
  const to = parseMonth(toArg, today);
  const from = fromArg === undefined || fromArg === "" ? (to ? addMonths(to, -5) : null) : parseMonth(fromArg, today);
  if (!from || !to) return fail("from・to は YYYY-MM（例: 2026-05）で指定してください");
  if (from > to) return fail("from は to より前の月にしてください");
  const months: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  if (months.length > MAX_MONTHS) return fail(`期間は${MAX_MONTHS}か月までにしてください`);

  // 期間の取引をまとめて1回で読み、月ごとに summarize（画面と同じ定義）に通す
  const [txs, fixedCosts, categories] = await Promise.all([
    loadTxsBetween(db, userId, `${from}-01`, addDays(monthEnd(to), 1)),
    db.fixedCost.findMany({ where: { userId } }),
    db.category.findMany({ where: { OR: [{ userId: null }, { userId }] }, select: { id: true, name: true, color: true } }),
  ]);
  const fixedConditions = fixedCosts.map(conditionFromRecord);
  const perMonth = months.map((month) =>
    summarize({ txs: txs.filter((t) => t.date.startsWith(month)), month, today, fixedConditions, budget: null, categories })
  );

  // カテゴリ名 → 月ごとの支出
  const rows = new Map<string, number[]>();
  perMonth.forEach((s, i) => {
    for (const c of s.byCategory) {
      const row = rows.get(c.name) ?? months.map(() => 0);
      row[i] += c.amount;
      rows.set(c.name, row);
    }
  });
  const data = {
    months,
    totals: perMonth.map((s) => ({ month: s.month, income: s.income.total, expense: s.expense.total, balance: s.balance })),
    categories: [...rows.entries()]
      .map(([name, amounts]) => ({ name, amounts, total: amounts.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total),
  };
  return { ok: true as const, data, text: `${from}〜${to} の${months.length}か月分のカテゴリ別の支出です（各月の今日までの分）。` };
}

/** 定期の収入・支出の一覧（次回日・金額・頻度・月あたり） */
export async function listFixedCosts(db: UserDb, userId: string, today: string) {
  const rows = await db.fixedCost.findMany({
    where: { userId },
    include: { category: { select: { name: true } } },
    orderBy: [{ isActive: "desc" }, { type: "asc" }, { amount: "desc" }],
  });
  const items = rows.map((fc) => {
    const amount = Number(fc.amount);
    return {
      name: fc.name,
      type: fc.type as "income" | "expense",
      amount,
      currency: fc.currency,
      cycle: fc.cycle,
      billing_day: fc.billingDay,
      billing_month: fc.billingMonth,
      next_date: nextDueDate(fc, today),
      monthly_equivalent: monthlyEquivalent(amount, fc.cycle as Cycle),
      category: fc.category?.name ?? "未分類",
      is_active: fc.isActive,
      is_subscription: fc.isSubscription,
      end_date: fc.endDate ? dbToDateOnly(fc.endDate) : null,
    };
  });
  // 月あたりの合計は円の有効なものだけ（ドル建ては為替で動くので別に数える）
  const active = items.filter((i) => i.is_active);
  const sum = (type: "income" | "expense") =>
    active.filter((i) => i.type === type && i.currency === "JPY").reduce((a, i) => a + i.monthly_equivalent, 0);
  const data = {
    items,
    monthly_total: { expense_jpy: sum("expense"), income_jpy: sum("income"), usd_items: active.filter((i) => i.currency !== "JPY").length },
  };
  return {
    ok: true as const,
    data,
    text: `定期は${active.length}件（停止中${items.length - active.length}件）。月あたりの定期支出は約${yen(data.monthly_total.expense_jpy)}（円建てのみ）です。`,
  };
}

/** カテゴリ一覧（AI が利用者の言い方をカテゴリ名に合わせるため） */
export async function listCategories(db: UserDb, userId: string) {
  const cats = await db.category.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    select: { name: true, type: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  const names = (type: string) => [...new Set(cats.filter((c) => c.type === type).map((c) => c.name))];
  const data = { expense: names("expense"), income: names("income") };
  return { ok: true as const, data, text: `支出のカテゴリ: ${data.expense.join("、")}` };
}

export interface ListRecentInput {
  month?: string;
  limit?: number;
}

/** 最近の取引（新しい順）。month を付けるとその月だけ（月の決算の確かめ用） */
export async function listRecent(db: UserDb, userId: string, input: ListRecentInput, today: string) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECENT) return fail(`limit は1〜${MAX_RECENT}の整数にしてください`);
  let range: { gte: Date; lte: Date } | undefined;
  if (input.month !== undefined && input.month !== "") {
    const month = parseMonth(input.month, today);
    if (!month) return fail("month は YYYY-MM（例: 2026-10）で指定してください");
    range = { gte: dateOnlyToDb(`${month}-01`), lte: dateOnlyToDb(monthEnd(month)) };
  }
  const where = { userId, deletedAt: null, ...(range ? { transactionDate: range } : {}) };
  const [rows, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        transactionDate: true,
        amount: true,
        type: true,
        kind: true,
        note: true,
        source: true,
        category: { select: { name: true } },
        account: { select: { name: true } },
      },
    }),
    db.transaction.count({ where }),
  ]);
  const items = rows.map((t) => ({
    id: t.id,
    date: dbToDateOnly(t.transactionDate),
    amount: Number(t.amount),
    type: t.type,
    kind: t.kind,
    category: t.category?.name ?? "未分類",
    account: t.account.name,
    note: t.note,
    source: t.source,
  }));
  const data = { items, returned: items.length, total };
  return {
    ok: true as const,
    data,
    text: `${range ? `${input.month} の` : "最近の"}取引 ${items.length}件を新しい順に返しました（該当は全部で${total}件）。`,
  };
}
