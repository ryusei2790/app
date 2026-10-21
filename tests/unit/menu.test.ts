/**
 * @file tests/unit/menu.test.ts
 * @description 初期画面固定＋チャットで機能追加（mywork#573 第1弾）の単体テスト。DB・AI 不要（AI はモック）。
 *   M1 カタログ: id 重複なし・リンク先の画面が実在・固定は5つ
 *   M2 tool: 追加・変更・外す・並べ替え、不明 id・固定・社長専用（社長以外）を拒む
 *   M3 チャット: AI の tool 呼び出しがマイメニューに反映され、作り出した id は拒まれる
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { CATALOG, FIXED_FEATURES } from "@/lib/menu/catalog";
import { applyTool, buildMenu, visibleLayout, describeCatalog, validateLayout, type LayoutItem } from "@/lib/menu/layout";
import { cleanHistory, runChat, type CreateMessage } from "@/lib/menu/chat";

const user = { isOwner: false };
const owner = { isOwner: true };
const item = (featureId: string): LayoutItem => ({ featureId, icon: null, label: null });

/** href → app/ 配下の page.tsx（ルートグループ (dashboard) か直下） */
function pageExists(href: string): boolean {
  const app = path.resolve(__dirname, "../../src/app");
  return ["(dashboard)", "."].some((g) => existsSync(path.join(app, g, href, "page.tsx")));
}

describe("M1 機能カタログ", () => {
  it("id が重複しない", () => {
    expect(new Set(CATALOG.map((f) => f.id)).size).toBe(CATALOG.length);
  });
  it("どの機能もリンク先の画面が実在する", () => {
    for (const f of CATALOG) expect(pageExists(f.href), f.href).toBe(true);
  });
  it("固定はホーム・レシート・収支一覧・チャット・設定の5つ（Q1 A）", () => {
    expect(FIXED_FEATURES.map((f) => f.id)).toEqual(["home", "receipt", "transactions", "chat", "settings"]);
  });
  it("メニューは固定5つ＋マイメニュー。カタログに無い id は出さない", () => {
    const m = buildMenu([item("dashboard"), item("nope"), item("home")], user);
    expect(m.fixed).toHaveLength(5);
    expect(m.mine.map((i) => i.id)).toEqual(["dashboard"]);
  });
  it("AI に渡す一覧に社長専用は社長だけ入る", () => {
    expect(describeCatalog([], user)).not.toContain("id=budget");
    expect(describeCatalog([], owner)).toContain("id=budget");
  });
});

describe("M2 マイメニューの tool", () => {
  it("追加（位置・アイコン・名前つき）", () => {
    const r = applyTool([item("review")], "add_feature", { id: "dashboard", position: 1, icon: "📈", label: "グラフ" }, user);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layout.map((i) => i.featureId)).toEqual(["dashboard", "review"]);
    expect(buildMenu(r.layout, user).mine[0]).toMatchObject({ icon: "📈", label: "グラフ", href: "/dashboard" });
  });
  it("二重追加・不明 id・固定・社長専用（社長以外）は拒む", () => {
    expect(applyTool([item("review")], "add_feature", { id: "review" }, user).ok).toBe(false);
    expect(applyTool([], "add_feature", { id: "hack" }, user).ok).toBe(false);
    expect(applyTool([], "add_feature", { id: "settings" }, user).ok).toBe(false);
    expect(applyTool([], "add_feature", { id: "budget" }, user).ok).toBe(false);
    expect(applyTool([], "add_feature", { id: "budget" }, owner).ok).toBe(true);
  });
  it("アイコン・名前の変更と既定に戻す", () => {
    const r1 = applyTool([item("review")], "update_feature", { id: "review", icon: "🧐", label: "チェック" }, user);
    expect(r1.ok && r1.layout[0]).toMatchObject({ icon: "🧐", label: "チェック" });
    const r2 = r1.ok ? applyTool(r1.layout, "update_feature", { id: "review", label: "" }, user) : r1;
    expect(r2.ok && r2.layout[0]).toMatchObject({ icon: "🧐", label: null });
  });
  it("長すぎる名前・タグ入りのアイコンは拒む", () => {
    expect(applyTool([item("review")], "update_feature", { id: "review", label: "あ".repeat(21) }, user).ok).toBe(false);
    expect(applyTool([item("review")], "update_feature", { id: "review", icon: "<b>" }, user).ok).toBe(false);
  });
  it("外す・並べ替え（全部1回ずつでないと拒む）", () => {
    const base = [item("review"), item("import")];
    const rm = applyTool(base, "remove_feature", { id: "review" }, user);
    expect(rm.ok && rm.layout.map((i) => i.featureId)).toEqual(["import"]);
    const ro = applyTool(base, "reorder", { ids: ["import", "review"] }, user);
    expect(ro.ok && ro.layout.map((i) => i.featureId)).toEqual(["import", "review"]);
    expect(applyTool(base, "reorder", { ids: ["import"] }, user).ok).toBe(false);
    expect(applyTool(base, "reorder", { ids: ["import", "import"] }, user).ok).toBe(false);
  });
  it("社長以外には隠れた予算台帳を並べ替え・AI の一覧に混ぜない", () => {
    const raw = [item("review"), item("budget"), item("gone")];
    expect(visibleLayout(raw, user).map((i) => i.featureId)).toEqual(["review"]);
    expect(visibleLayout(raw, owner).map((i) => i.featureId)).toEqual(["review", "budget"]);
  });
  it("元に戻す用の配列の検査", () => {
    expect(validateLayout([item("review")], user)).toEqual([item("review")]);
    expect(validateLayout([item("review"), item("review")], user)).toBeNull();
    expect(validateLayout([item("home")], user)).toBeNull();
    expect(validateLayout("x", user)).toBeNull();
  });
});

function msg(content: Anthropic.ContentBlock[], stop: Anthropic.StopReason): Anthropic.Message {
  return { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Message;
}
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as Anthropic.ContentBlock;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.ContentBlock;

function scripted(replies: Anthropic.Message[]): { create: CreateMessage; calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    create: async (p) => {
      calls.push(structuredClone(p));
      return replies[calls.length - 1];
    },
  };
}

describe("M3 チャット", () => {
  it("AI の add_feature がマイメニューに入り、結果が返る", async () => {
    const { create, calls } = scripted([
      msg([toolUse("t1", "add_feature", { id: "dashboard" })], "tool_use"),
      msg([text("ダッシュボードを追加しました")], "end_turn"),
    ]);
    const r = await runChat({ history: [{ role: "user", content: "ダッシュボード出して" }], layout: [], isOwner: false, create });
    expect(r.layout.map((i) => i.featureId)).toEqual(["dashboard"]);
    expect(r.changes).toHaveLength(1);
    expect(r.reply).toContain("ダッシュボード");
    // 2回目の呼び出しに tool の結果が渡っている
    const last = calls[1].messages.at(-1)!;
    expect(JSON.stringify(last.content)).toContain("tool_result");
    // カタログはシステムプロンプトに入っている
    expect(String(calls[0].system)).toContain("id=dashboard");
  });
  it("AI が作り出した id は拒まれ、マイメニューは変わらない", async () => {
    const { create } = scripted([
      msg([toolUse("t1", "add_feature", { id: "stocks" })], "tool_use"),
      msg([text("その機能はまだありません")], "end_turn"),
    ]);
    const r = await runChat({ history: [{ role: "user", content: "株の管理" }], layout: [], isOwner: false, create });
    expect(r.layout).toEqual([]);
    expect(r.changes).toEqual([]);
  });
  it("要望は saveRequest に渡り、マイメニューは変わらない（1回の送信で1件まで）", async () => {
    const saved: string[] = [];
    const { create } = scripted([
      msg([toolUse("t1", "request_feature", { text: "  家族で  共有したい " }), toolUse("t2", "request_feature", { text: "もう1件" })], "tool_use"),
      msg([text("要望を送りました")], "end_turn"),
    ]);
    const r = await runChat({
      history: [{ role: "user", content: "送って" }],
      layout: [],
      isOwner: false,
      create,
      saveRequest: async (t) => {
        saved.push(t);
      },
    });
    expect(saved).toEqual(["家族で 共有したい"]);
    expect(r.requested).toBe(true);
    expect(r.layout).toEqual([]);
    expect(r.changes).toHaveLength(1);
  });
  it("saveRequest が無い・文が空なら要望は保存されない", async () => {
    const { create } = scripted([
      msg([toolUse("t1", "request_feature", { text: "" })], "tool_use"),
      msg([text("すみません")], "end_turn"),
    ]);
    const r = await runChat({ history: [{ role: "user", content: "送って" }], layout: [], isOwner: false, create });
    expect(r.requested).toBe(false);
    expect(r.changes).toEqual([]);
  });
  it("会話の形を検査する（user で終わる・長さを絞る）", () => {
    expect(cleanHistory([{ role: "user", content: "a" }])).toEqual([{ role: "user", content: "a" }]);
    expect(cleanHistory([{ role: "assistant", content: "a" }])).toBeNull();
    expect(cleanHistory([{ role: "system", content: "a" }])).toBeNull();
    expect(cleanHistory([{ role: "user", content: "x".repeat(900) }])![0].content).toHaveLength(500);
  });
});
