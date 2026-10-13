/**
 * @file api/v1/import/route.ts
 * @description CSVインポート（POST）・インポート履歴取得（GET）エンドポイント。
 * POST は multipart/form-data で CSV ファイルを受け取る。形式は2系統:
 *   - 家計簿アプリ形式（金額,日付,メモ,カテゴリー名。ヘッダーで自動判定）… mode=preview（保存しない）→ mode=commit（選んだ行だけ保存）
 *       重複は「行の目印」で判定し、何回入れても増えない（lib/csv/import-key.ts、テスト一覧 I）
 *   - カード会社（card_type=epos|saison）… 従来どおり一括で保存。重複は同一ファイル名＋今月で判定
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 * 履歴（csv_imports）と取引（transactions）・定期（fixed_costs）は1つのトランザクションで保存し、
 * 途中で失敗したらどれも残さない。CSV の中身はログに出さない（S11）。
 */

import { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { checkAccount } from "@/lib/ownership";
import { ok, error, requireAuth, serializeCsvImport } from "@/lib/api-helpers";
import { parseCsv, type CardType } from "@/lib/csv/parser";
import { decodeCsv } from "@/lib/csv/decode";
import { detectFormat, parseKakebo } from "@/lib/csv/kakebo";
import { withImportKeys } from "@/lib/csv/import-key";
import { commitPlan, loadPlan, resolveAccount } from "@/lib/import/kakebo-import";
import { todayJst } from "@/lib/date/jst";

/** 受け付ける CSV の大きさ（I12）。家計簿 約1,100行で 40KB ほどなので十分に大きい */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 20_000;

/**
 * 家計簿アプリ形式の取り込み。preview は計画を返すだけ、commit は計画を作り直して保存する
 * （preview の結果は信用しない。間に別の取り込みが走っても一意索引で増えない）。
 */
async function importKakebo(
  userId: string,
  text: string,
  formData: FormData,
  filename: string
) {
  const mode = formData.get("mode") === "commit" ? "commit" : "preview";

  // 1. 読む（DB に触る前に済ませ、トランザクションを短くする）
  const { rows, invalid } = parseKakebo(text);
  if (rows.length + invalid.length > MAX_CSV_ROWS) {
    return error("VALIDATION_ERROR", `CSV は ${MAX_CSV_ROWS.toLocaleString()} 行までです`, 422);
  }
  if (rows.length === 0) {
    return error("VALIDATION_ERROR", "取り込める行がありません", 422, { invalid });
  }
  const keyed = withImportKeys(rows);
  const today = todayJst();

  // 2. preview: 自分の既存データと照合した計画を返す（何も保存しない）
  if (mode === "preview") {
    const plan = await withUserDb(userId, (db) => loadPlan(db, userId, keyed, today));
    return ok({
      format: "kakebo",
      counts: {
        fresh: plan.fresh.length,
        already: plan.already.length,
        recurring_done: plan.recurringDone.length,
        future: plan.future.length,
        invalid: invalid.length,
      },
      future: plan.future.map((f) => ({
        key: f.importKey,
        date: f.date,
        amount: f.amount,
        type: f.type,
        note: f.note,
        category_name: f.categoryName,
        billing_day: f.billingDay,
        already_scheduled: f.alreadyScheduled,
      })),
      invalid,
      sample: plan.fresh.slice(0, 5).map((r) => ({
        date: r.date,
        amount: r.amount,
        type: r.type,
        note: r.note,
        category_name: r.categoryName,
      })),
    });
  }

  // 3. commit: 口座と「定期にする予定」を確かめてから保存
  const accountId = formData.get("account_id");
  if (typeof accountId !== "string" || accountId === "") {
    return error("VALIDATION_ERROR", "account_id は必須です（新しく作るなら new）", 422);
  }
  let scheduleKeys: Set<string>;
  try {
    const raw = formData.get("schedule_keys");
    const parsed: unknown = typeof raw === "string" && raw !== "" ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === "string")) throw new Error();
    scheduleKeys = new Set(parsed);
  } catch {
    return error("VALIDATION_ERROR", "schedule_keys は文字列の配列（JSON）で指定してください", 422);
  }

  try {
    return await withUserDb(userId, async (db) => {
      const account = await resolveAccount(db, userId, accountId);
      if (!account) return error("NOT_FOUND", "指定された口座が見つかりません", 404);
      const plan = await loadPlan(db, userId, keyed, today);
      const result = await commitPlan(db, userId, account, filename, plan, scheduleKeys);
      return ok({
        format: "kakebo",
        import_id: result.importId,
        account_id: account,
        imported_count: result.imported,
        skipped_count: result.skipped,
        scheduled_count: result.scheduled,
        invalid,
      });
    });
  } catch {
    // トランザクションごと巻き戻っているので、何も残っていない。中身はログに出さない
    return error("INTERNAL_ERROR", "データの保存中にエラーが発生しました", 500);
  }
}

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

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return error("VALIDATION_ERROR", "file は必須です", 422);
  }
  if (file.size > MAX_CSV_BYTES) {
    return error("PAYLOAD_TOO_LARGE", "CSV は 5MB までです", 413);
  }
  const cardTypeRaw = formData.get("card_type");

  // カード会社の指定が無ければ、ヘッダーで家計簿アプリ形式かを判定する
  if (cardTypeRaw !== "epos" && cardTypeRaw !== "saison") {
    if (cardTypeRaw !== null && cardTypeRaw !== "" && cardTypeRaw !== "auto" && cardTypeRaw !== "kakebo") {
      return error("VALIDATION_ERROR", "card_type は epos・saison・kakebo のどれかです", 422);
    }
    const text = decodeCsv(await file.arrayBuffer());
    if (detectFormat(text) !== "kakebo") {
      return error("VALIDATION_ERROR", "CSV の形式が分かりません（カード会社を選んでください）", 422);
    }
    return importKakebo(user.id, text, formData, file.name);
  }

  const cardType: CardType = cardTypeRaw;
  const accountId = formData.get("account_id");
  if (typeof accountId !== "string" || accountId === "") {
    return error("VALIDATION_ERROR", "file, account_id, card_type は必須です", 422);
  }

  // CSV テキストを読み込んでパース（DB に触る前に済ませ、トランザクションを短くする）
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

  try {
    return await withUserDb(user.id, async (db) => {
      // 口座の所有権チェック
      const account = await checkAccount(db, user.id, accountId);
      if (!account.ok) return error("NOT_FOUND", account.message, 404);

      // 重複インポート判定: 同一ユーザー・口座・ファイル名・当月 のレコードが存在するか確認
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const duplicate = await db.csvImport.findFirst({
        where: {
          userId: user.id,
          accountId,
          filename: file.name,
          importedAt: { gte: monthStart, lte: monthEnd },
          status: "success",
        },
      });
      if (duplicate) {
        return error("CONFLICT", "同じファイルが今月すでにインポートされています", 409);
      }

      const csvImport = await db.csvImport.create({
        data: {
          userId: user.id,
          accountId,
          filename: file.name,
          status: "success",
          rowCount: preview.length,
          skippedCount: 0,
        },
      });

      await db.transaction.createMany({
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

      return ok({
        import_id: csvImport.id,
        imported_count: preview.length,
        skipped_count: 0,
        preview: preview.slice(0, 5), // プレビューは先頭5件のみ返す
      });
    });
  } catch {
    // トランザクションごと巻き戻っているので、履歴も取引も残っていない
    return error("INTERNAL_ERROR", "データの保存中にエラーが発生しました", 500);
  }
}

/** GET /api/v1/import — インポート履歴 */
export async function GET() {
  const { user, response } = await requireAuth();
  if (response) return response;

  const imports = await withUserDb(user.id, (db) =>
    db.csvImport.findMany({
      where: { userId: user.id },
      include: { account: { select: { id: true, name: true } } },
      orderBy: { importedAt: "desc" },
      take: 50, // 直近50件
    })
  );

  return ok(imports.map(serializeCsvImport), { total: imports.length });
}
