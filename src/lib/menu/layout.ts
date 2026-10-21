/**
 * @file lib/menu/layout.ts
 * @description マイメニューの並びを変える処理（mywork#573）。DB に触らない純粋な関数だけを置く。
 * チャットの AI の tool はすべてここを通るので、カタログに無い id・固定の機能・社長専用（社長以外）はここで拒む。
 * AI ができるのは「並びを変える」ことだけ（URL は作れない・データは触れない）。
 */

import { catalogFor, findFeature, FIXED_FEATURES, type Feature } from "./catalog";

/** マイメニューの1件（DB の user_layout と同じ形。position は配列の順で表す） */
export interface LayoutItem {
  featureId: string;
  icon: string | null;
  label: string | null;
}

export interface MenuItem {
  id: string;
  href: string;
  label: string;
  icon: string;
}

const ICON_MAX = 8;
const LABEL_MAX = 20;

function toMenuItem(f: Feature, item?: LayoutItem): MenuItem {
  return { id: f.id, href: f.href, label: item?.label ?? f.label, icon: item?.icon ?? f.icon };
}

/** 画面に出すメニュー。固定の5つ＋マイメニュー（カタログから消えた機能・見えない機能は飛ばす） */
export function buildMenu(layout: LayoutItem[], { isOwner }: { isOwner: boolean }) {
  const fixed = FIXED_FEATURES.map((f) => toMenuItem(f));
  const mine = layout.flatMap((item) => {
    const f = findFeature(item.featureId, { isOwner });
    return f && !f.fixed ? [toMenuItem(f, item)] : [];
  });
  return { fixed, mine };
}

/**
 * 本人に見えるものだけに絞る。移行で全員に入れた予算台帳（社長専用）や、カタログから消えた機能を
 * 社長以外の並べ替え・AI の一覧に混ぜないため（混ぜると「全部1回ずつ」の並べ替えが通らない）
 */
export function visibleLayout(layout: LayoutItem[], { isOwner }: { isOwner: boolean }): LayoutItem[] {
  return layout.filter((i) => {
    const f = findFeature(i.featureId, { isOwner });
    return f && !f.fixed;
  });
}

export type ToolResult = { ok: true; layout: LayoutItem[]; message: string } | { ok: false; message: string };

function checkFeature(id: unknown, isOwner: boolean): Feature | string {
  if (typeof id !== "string") return "機能の id がありません";
  const f = findFeature(id, { isOwner });
  if (!f) return `「${id}」という機能はありません`;
  if (f.fixed) return `「${f.label}」は初期画面の機能なので変えられません`;
  return f;
}

function cleanIcon(v: unknown): string | null | undefined | Error {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || [...v].length > ICON_MAX || /[<>]/.test(v)) return new Error("アイコンは絵文字1つにしてください");
  return v;
}

function cleanLabel(v: unknown): string | null | undefined | Error {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") return new Error("名前が不正です");
  const t = v.trim();
  if (t.length < 1 || t.length > LABEL_MAX) return new Error(`名前は1〜${LABEL_MAX}文字にしてください`);
  return t;
}

/**
 * チャットの tool を1つ実行する。layout は変えず、新しい配列を返す。
 * name: add_feature / update_feature / remove_feature / reorder
 */
export function applyTool(
  layout: LayoutItem[],
  name: string,
  input: Record<string, unknown>,
  { isOwner }: { isOwner: boolean }
): ToolResult {
  switch (name) {
    case "add_feature": {
      const f = checkFeature(input.id, isOwner);
      if (typeof f === "string") return { ok: false, message: f };
      if (layout.some((i) => i.featureId === f.id)) return { ok: false, message: `「${f.label}」はもうマイメニューにあります` };
      const icon = cleanIcon(input.icon);
      const label = cleanLabel(input.label);
      if (icon instanceof Error) return { ok: false, message: icon.message };
      if (label instanceof Error) return { ok: false, message: label.message };
      const item: LayoutItem = { featureId: f.id, icon: icon ?? null, label: label ?? null };
      const pos = typeof input.position === "number" && Number.isInteger(input.position) ? input.position - 1 : layout.length;
      const next = [...layout];
      next.splice(Math.max(0, Math.min(pos, layout.length)), 0, item);
      return { ok: true, layout: next, message: `「${f.label}」をマイメニューの${next.indexOf(item) + 1}番目に追加しました` };
    }
    case "update_feature": {
      const f = checkFeature(input.id, isOwner);
      if (typeof f === "string") return { ok: false, message: f };
      const idx = layout.findIndex((i) => i.featureId === f.id);
      if (idx < 0) return { ok: false, message: `「${f.label}」はマイメニューにありません。先に追加してください` };
      const icon = cleanIcon(input.icon);
      const label = cleanLabel(input.label);
      if (icon instanceof Error) return { ok: false, message: icon.message };
      if (label instanceof Error) return { ok: false, message: label.message };
      const next = [...layout];
      next[idx] = {
        ...next[idx],
        ...(icon !== undefined ? { icon } : {}),
        ...(label !== undefined ? { label } : {}),
      };
      return { ok: true, layout: next, message: `「${f.label}」を変更しました` };
    }
    case "remove_feature": {
      const f = checkFeature(input.id, isOwner);
      if (typeof f === "string") return { ok: false, message: f };
      if (!layout.some((i) => i.featureId === f.id)) return { ok: false, message: `「${f.label}」はマイメニューにありません` };
      return { ok: true, layout: layout.filter((i) => i.featureId !== f.id), message: `「${f.label}」をマイメニューから外しました` };
    }
    case "reorder": {
      const ids = input.ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return { ok: false, message: "並び順が不正です" };
      const current = layout.map((i) => i.featureId);
      if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) {
        return { ok: false, message: "並び順にはマイメニューの機能を全部1回ずつ入れてください" };
      }
      const next = ids.map((id) => layout.find((i) => i.featureId === id)!);
      return { ok: true, layout: next, message: "マイメニューを並べ替えました" };
    }
    default:
      return { ok: false, message: `不明な操作です: ${name}` };
  }
}

/** 画面・API から渡された配列が正しいか（「元に戻す」で使う） */
export function validateLayout(raw: unknown, { isOwner }: { isOwner: boolean }): LayoutItem[] | null {
  if (!Array.isArray(raw) || raw.length > catalogFor({ isOwner }).length) return null;
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const { featureId, icon, label } = r as Record<string, unknown>;
    const f = checkFeature(featureId, isOwner);
    if (typeof f === "string" || seen.has(f.id)) return null;
    const ci = cleanIcon(icon);
    const cl = cleanLabel(label);
    if (ci instanceof Error || cl instanceof Error) return null;
    seen.add(f.id);
    out.push({ featureId: f.id, icon: ci ?? null, label: cl ?? null });
  }
  return out;
}

/** AI に渡す機能一覧（追加済みかどうか付き）。金額などのデータは入れない */
export function describeCatalog(layout: LayoutItem[], { isOwner }: { isOwner: boolean }): string {
  return catalogFor({ isOwner })
    .map((f) => {
      const state = f.fixed ? "初期画面（変更不可）" : layout.some((i) => i.featureId === f.id) ? "マイメニューに追加済み" : "未追加";
      return `- id=${f.id} ${f.icon} ${f.label}: ${f.description}［${state}］`;
    })
    .join("\n");
}
