/**
 * @file api/v1/chat/route.ts
 * @description メニューのチャット（mywork#573）。会話を受け取り、AI の返事と変わったマイメニューを返す。
 * 1人1日30回まで（CHAT_QUOTA_USER_DAY で変えられる）。社長は上限なし。会話は保存しない。
 */

import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { isOwner } from "@/lib/features";
import { buildMenu, visibleLayout } from "@/lib/menu/layout";
import { cleanHistory, getCreateMessage, runChat } from "@/lib/menu/chat";
import { bumpChatUsage, loadLayout, saveLayout } from "@/lib/menu/store";

function dailyLimit(): number {
  const v = Number(process.env.CHAT_QUOTA_USER_DAY);
  return Number.isInteger(v) && v > 0 ? v : 30;
}

/** POST /api/v1/chat  body: { messages: [{ role, content }] } */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const history = cleanHistory(body.messages);
  if (!history) return error("VALIDATION_ERROR", "メッセージが不正です", 422);

  const create = getCreateMessage();
  if (!create) return error("AI_UNAVAILABLE", "いまチャットは使えません（AI の設定がありません）", 503);

  const owner = isOwner(user);
  const used = await bumpChatUsage(user.id);
  if (!owner && used > dailyLimit()) {
    return error("RATE_LIMITED", `今日のチャットは上限（${dailyLimit()}回）に達しました。日本時間の0時に戻ります。`, 429);
  }

  const before = visibleLayout(await loadLayout(user.id), { isOwner: owner });
  let result;
  try {
    result = await runChat({ history, layout: before, isOwner: owner, create, model: process.env.CHAT_MODEL });
  } catch (e) {
    console.error("[chat] AI の呼び出しに失敗", e instanceof Error ? e.message : e);
    return error("AI_UNAVAILABLE", "AI が応答しませんでした。少し待ってからもう一度送ってください。", 503);
  }
  if (result.changes.length > 0) await saveLayout(user.id, result.layout);

  return ok({
    reply: result.reply,
    changes: result.changes,
    // 「元に戻す」用に変える前の並びも返す
    previous: result.changes.length > 0 ? before : null,
    menu: buildMenu(result.layout, { isOwner: owner }),
  });
}
