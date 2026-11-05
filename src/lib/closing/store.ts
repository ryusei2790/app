/**
 * @file lib/closing/store.ts
 * @description 決算日の設定と月の提案の読み書き（mywork#1150 第2弾）。すべて withUserDb の中で行うので RLS が効く。
 */

import { withUserDb } from "@/lib/db";
import type { ClosingDay, ClosingResult } from "./bot";

export interface ClosingReportRow {
  month: string;
  markdown: string;
  model: string | null;
  generations: number;
  updatedAt: string;
}

/** 決算日（未設定なら null＝月末） */
export async function loadClosingDay(userId: string): Promise<ClosingDay> {
  return withUserDb(userId, async (db) => {
    const s = await db.closingSetting.findUnique({ where: { userId } });
    return s?.closingDay ?? null;
  });
}

export async function saveClosingDay(userId: string, day: ClosingDay): Promise<void> {
  await withUserDb(userId, (db) =>
    db.closingSetting.upsert({
      where: { userId },
      create: { userId, closingDay: day },
      update: { closingDay: day, updatedAt: new Date() },
    })
  );
}

function toRow(r: { month: string; markdown: string; model: string | null; generations: number; updatedAt: Date }): ClosingReportRow {
  return { month: r.month, markdown: r.markdown, model: r.model, generations: r.generations, updatedAt: r.updatedAt.toISOString() };
}

export async function loadClosingReport(userId: string, month: string): Promise<ClosingReportRow | null> {
  return withUserDb(userId, async (db) => {
    const r = await db.closingReport.findUnique({ where: { userId_month: { userId, month } } });
    return r ? toRow(r) : null;
  });
}

/** 過去の提案の一覧（新しい順・本文なし） */
export async function listClosingMonths(userId: string): Promise<string[]> {
  return withUserDb(userId, async (db) => {
    const rows = await db.closingReport.findMany({ where: { userId }, select: { month: true }, orderBy: { month: "desc" }, take: 24 });
    return rows.map((r) => r.month);
  });
}

/** 作った提案を保存する。同じ月は上書きして作った回数を数える */
export async function saveClosingReport(userId: string, month: string, r: ClosingResult): Promise<ClosingReportRow> {
  return withUserDb(userId, async (db) => {
    const data = { markdown: r.markdown, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    const row = await db.closingReport.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month, ...data },
      update: { ...data, generations: { increment: 1 }, updatedAt: new Date() },
    });
    return toRow(row);
  });
}
