/**
 * @file lib/budget/rule-input.ts
 * @description 対応表（budget_rules）の入力チェック。POST と PUT で同じ規則を使う。
 * undefined は「指定なし（変えない）」、null は「無し」（frame_id の null は「枠の外」）。
 */

import { isUuid } from "@/lib/db";
import type { Parsed } from "@/lib/validation/transaction";

export interface RuleFields {
  categoryId?: string | null;
  memoKeyword?: string | null;
  frameId?: string | null;
  priority?: number;
}

export function parseRuleFields(body: Record<string, unknown>, opts: { requireFrame: boolean }): Parsed<RuleFields> {
  const out: RuleFields = {};

  if (body.category_id !== undefined) {
    if (body.category_id !== null && !isUuid(body.category_id)) return { ok: false, message: "category_id が不正です" };
    out.categoryId = body.category_id as string | null;
  }

  if (body.memo_keyword !== undefined) {
    if (body.memo_keyword === null || body.memo_keyword === "") out.memoKeyword = null;
    else if (typeof body.memo_keyword !== "string" || body.memo_keyword.trim().length > 50) {
      return { ok: false, message: "memo_keyword は50文字までの文字列です" };
    } else out.memoKeyword = body.memo_keyword.trim() || null;
  }

  if (!("frame_id" in body)) {
    if (opts.requireFrame) return { ok: false, message: "frame_id は必須です（枠の外なら null）" };
  } else {
    if (body.frame_id !== null && !isUuid(body.frame_id)) return { ok: false, message: "frame_id が不正です" };
    out.frameId = body.frame_id as string | null;
  }

  if (body.priority !== undefined) {
    if (typeof body.priority !== "number" || !Number.isInteger(body.priority) || Math.abs(body.priority) > 1_000_000) {
      return { ok: false, message: "priority は整数です" };
    }
    out.priority = body.priority;
  }

  return { ok: true, value: out };
}
