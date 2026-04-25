/**
 * @file api/v1/import/route.ts
 * @description CSVインポート（POST）・インポート履歴取得（GET）エンドポイント。
 * POST: multipart/form-data で CSV ファイルを受け取り、パース→一括インサートする。
 * 重複インポート判定: 同一ユーザー・口座・ファイル名・年月が一致する場合はエラー。
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, error, requireAuth, serializeCsvImport } from "@/lib/api-helpers";
import { parseCsv, type CardType } from "@/lib/csv/parser";

/** POST /api/v1/import — CSVインポート */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  // multipart/form-data からファイルと付属パラメータを取得
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return error("VALIDATION_ERROR", "フォームデータの解析に失敗しました", 422);
  }

  const file = formData.get("file") as File | null;
  const accountId = formData.get("account_id") as string | null;
  const cardType = formData.get("card_type") as CardType | null;

  if (!file || !accountId || !cardType) {
    return error("VALIDATION_ERROR", "file, account_id, card_type は必須です", 422);
  }
  if (!["epos", "saison"].includes(cardType)) {
    return error("VALIDATION_ERROR", "card_type は epos または saison です", 422);
  }

  // 口座の所有権チェック
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: user.id },
  });
  if (!account) {
    return error("NOT_FOUND", "指定された口座が見つかりません", 404);
  }

  // 重複インポート判定: 同一ユーザー・口座・ファイル名・当月 のレコードが存在するか確認
  const now = new Date();
  const importYear = now.getFullYear();
  const importMonth = now.getMonth() + 1;
  const monthStart = new Date(importYear, importMonth - 1, 1);
  const monthEnd = new Date(importYear, importMonth, 0);

  const duplicate = await prisma.csvImport.findFirst({
    where: {
      userId: user.id,
      accountId,
      filename: file.name,
      importedAt: { gte: monthStart, lte: monthEnd },
      status: "success",
    },
  });
  if (duplicate) {
    return error(
      "CONFLICT",
      "同じファイルが今月すでにインポートされています",
      409
    );
  }

  // CSV テキストを読み込んでパース
  const csvText = await file.text();
  let preview;
  try {
    preview = parseCsv(csvText, cardType);
  } catch (e) {
    return error(
      "VALIDATION_ERROR",
      `CSV 解析エラー: ${e instanceof Error ? e.message : "不明なエラー"}`,
      422
    );
  }

  if (preview.length === 0) {
    return error("VALIDATION_ERROR", "有効なデータが含まれていません", 422);
  }

  // インポート履歴レコードを作成（transactions 挿入前に status='pending' で記録）
  const csvImport = await prisma.csvImport.create({
    data: {
      userId: user.id,
      accountId,
      filename: file.name,
      status: "pending",
      rowCount: preview.length,
      skippedCount: 0,
    },
  });

  // transactions を一括インサート
  try {
    await prisma.transaction.createMany({
      data: preview.map((row) => ({
        userId: user.id,
        accountId,
        categoryId: null, // インポート後にユーザーが手動でカテゴリ付け
        amount: row.amount,
        type: "expense" as const,
        transactionDate: new Date(row.transaction_date),
        note: row.note,
        source: "csv" as const,
        csvImportId: csvImport.id,
      })),
      skipDuplicates: true,
    });

    // 成功ステータスに更新
    await prisma.csvImport.update({
      where: { id: csvImport.id },
      data: { status: "success" },
    });
  } catch (e) {
    // インサート失敗時はエラーステータスに更新
    await prisma.csvImport.update({
      where: { id: csvImport.id },
      data: { status: "error" },
    });
    return error("INTERNAL_ERROR", "データの保存中にエラーが発生しました", 500);
  }

  return ok({
    import_id: csvImport.id,
    imported_count: preview.length,
    skipped_count: 0,
    preview: preview.slice(0, 5), // プレビューは先頭5件のみ返す
  });
}

/** GET /api/v1/import — インポート履歴 */
export async function GET(_request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const imports = await prisma.csvImport.findMany({
    where: { userId: user.id },
    include: {
      account: { select: { id: true, name: true } },
    },
    orderBy: { importedAt: "desc" },
    take: 50, // 直近50件
  });

  return ok(imports.map(serializeCsvImport), { total: imports.length });
}
