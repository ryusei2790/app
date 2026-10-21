/**
 * @file lib/menu/chat.ts
 * @description メニューのチャット（mywork#573）。Claude Haiku 5.5（Anthropic 直）に機能カタログと tool を渡し、
 * 「ダッシュボード出して」のような頼みをマイメニューの変更に変える。
 *
 * - tool は並びを変えるものだけ（applyTool を通るので、カタログに無い id・固定の機能は拒まれる）
 * - 家計簿のデータ（金額など）は AI に渡さない。会話は保存しない（ブラウザのメモリだけ）
 * - 無い機能の要望（request_feature）は第2弾。今は「まだありません」と答えさせる
 */

import Anthropic from "@anthropic-ai/sdk";
import { toAnthropicModelId } from "@/lib/receipt/providers";
import { applyTool, describeCatalog, type LayoutItem } from "./layout";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatChange {
  message: string;
}

const MAX_TURNS = 5;
const MAX_HISTORY = 10;
const MAX_TEXT = 500;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "add_feature",
    description: "機能をマイメニューに追加する。position は1始まり（省略で末尾）。icon は絵文字1つ、label は表示名（省略で既定）",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        position: { type: "integer" },
        icon: { type: "string" },
        label: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_feature",
    description: "マイメニューにある機能のアイコン・表示名を変える。空文字で既定に戻す",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, icon: { type: "string" }, label: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "remove_feature",
    description: "機能をマイメニューから外す（機能やデータは消えない。また追加できる）",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "reorder",
    description: "マイメニューの並びを変える。ids にマイメニューの機能 id を全部、新しい順に入れる",
    input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
  },
];

function systemPrompt(layout: LayoutItem[], isOwner: boolean): string {
  return [
    "あなたは家計簿アプリ「カレンダー家計簿」のメニュー係です。日本語で短く、やさしく答えます。",
    "メニューは「初期画面」（固定。変えられない）と「マイメニュー」（本人が選んだ機能）に分かれています。",
    "できること: 下の一覧にある機能の説明、マイメニューへの追加・外す・並べ替え・アイコン（絵文字）と表示名の変更。tool を使って実行します。",
    "一覧に無い機能は作れません。「まだその機能はありません」と正直に伝えます（id を作り出さない）。",
    "家計簿の金額・取引の中身は見られません。聞かれたら該当する画面を案内します。",
    "どれを指すか迷うときは、実行せずに聞き返します。実行したら、どこに何をしたかを1〜2文で伝えます。",
    "",
    "## 機能の一覧",
    describeCatalog(layout, { isOwner }),
    "",
    "## いまのマイメニュー（上から順）",
    layout.length ? layout.map((i, n) => `${n + 1}. ${i.featureId}`).join("\n") : "（空）",
  ].join("\n");
}

/** 画面から来た会話を、長さと形を絞って AI に渡せる形にする */
export function cleanHistory(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) return null;
    out.push({ role, content: content.slice(0, MAX_TEXT) });
  }
  // AI の API は user から始まり user で終わる必要がある
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

/** テストで AI を差し替えるための口（本番では使わない） */
let createOverride: CreateMessage | null = null;
export function setCreateMessageForTest(fn: CreateMessage | null) {
  createOverride = fn;
}

export function getCreateMessage(env: Record<string, string | undefined> = process.env): CreateMessage | null {
  if (createOverride) return createOverride;
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return (params) => client.messages.create(params);
}

export async function runChat(opts: {
  history: ChatMessage[];
  layout: LayoutItem[];
  isOwner: boolean;
  create: CreateMessage;
  model?: string;
}): Promise<{ reply: string; layout: LayoutItem[]; changes: ChatChange[] }> {
  let layout = opts.layout;
  const changes: ChatChange[] = [];
  const messages: Anthropic.MessageParam[] = opts.history.map((m) => ({ role: m.role, content: m.content }));

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await opts.create({
      model: toAnthropicModelId(opts.model),
      max_tokens: 800,
      system: systemPrompt(layout, opts.isOwner),
      tools: TOOLS,
      messages,
    });
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      return { reply: text || "すみません、うまく答えられませんでした。", layout, changes };
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = uses.map((u) => {
      const r = applyTool(layout, u.name, (u.input ?? {}) as Record<string, unknown>, { isOwner: opts.isOwner });
      if (r.ok) {
        layout = r.layout;
        changes.push({ message: r.message });
      }
      return { type: "tool_result", tool_use_id: u.id, content: r.message, is_error: !r.ok };
    });
    messages.push({ role: "user", content: results });
  }
  return { reply: "操作が多すぎたので途中で止めました。もう一度、1つずつ頼んでください。", layout, changes };
}
