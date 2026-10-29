/**
 * @file lib/menu/catalog.ts
 * @description 機能カタログ（mywork#573）。アプリにある機能の唯一の一覧で、メニューとチャットの AI の両方がここを読む。
 *
 * - fixed: true の5つは「初期画面」。全員に同じ並びで出し、本人もチャットも変えられない（設計 Q1 A）
 * - それ以外は「マイメニュー」に置ける機能。本人がチャットで追加・外す・並べ替え・アイコンと名前の変更をする（Q2 A）
 * - 機能を足すときはここに1件足すだけで、メニューにも AI の知識にも入る（初期画面は変えない）
 * - ownerOnly は社長にだけ出す。守りの本体は API（requireOwner）と画面の notFound()（lib/nav.ts と同じ考え）
 */

import { DEFINITIONS_PATH } from "@/lib/aggregate/definitions";
import { HELP_PATH } from "@/lib/help/sections";
import { CHANGES_PATH } from "@/lib/changes/history";

export interface Feature {
  id: string;
  label: string;
  icon: string;
  href: string;
  /** AI に渡す説明（何ができるか・使い方）。金額などのデータは書かない */
  description: string;
  fixed?: boolean;
  ownerOnly?: boolean;
}

export const CATALOG: Feature[] = [
  { id: "home", label: "カレンダー", icon: "📅", href: "/calendar", fixed: true, description: "ホーム。日ごとの収支をカレンダーで見る。日付を押すとその日の取引を見て追加できる" },
  { id: "receipt", label: "レシート", icon: "📷", href: "/receipts/new", fixed: true, description: "レシートを撮ると AI が読み取り、確認して登録する。手入力もここから" },
  { id: "transactions", label: "収支一覧", icon: "📋", href: "/transactions", fixed: true, description: "取引の一覧。検索・編集・削除" },
  { id: "chat", label: "チャット", icon: "💬", href: "/chat", fixed: true, description: "このチャット。機能を探してメニューに足す" },
  { id: "settings", label: "設定", icon: "⚙️", href: "/settings", fixed: true, description: "口座・カテゴリー・書き出し（CSV・スプレッドシート）・アカウント" },
  { id: "dashboard", label: "ダッシュボード", icon: "📊", href: "/dashboard", description: "月ごとの収入・支出・カテゴリー別の内訳をグラフで見る" },
  { id: "ask", label: "質問して集計", icon: "🔎", href: "/ask", description: "「今月の食費は？」「先月の支出の内訳」「直近3か月の外食を月別で」のように聞くと、決まったルールで読んで画面と同じ定義で計算する。AI には送らない" },
  { id: "review", label: "要確認", icon: "🔍", href: "/review", description: "カテゴリー未設定など確認が要る取引をまとめて直す" },
  { id: "import", label: "CSVインポート", icon: "📥", href: "/import", description: "他の家計簿アプリや銀行の CSV を取り込む。取り込みの取り消しもできる" },
  { id: "fixed-costs", label: "定期の収入・支出", icon: "🔁", href: "/fixed-costs", description: "家賃・給料・サブスクなど毎月決まった収入・支出を登録して自動で記録する" },
  { id: "subscriptions", label: "サブスク", icon: "🔔", href: "/subscriptions", description: "サブスクだけを次回更新が近い順に見る。月・年あたりの合計、管理ページ・解約ページへのリンク、支払いカード" },
  { id: "help", label: "使い方", icon: "❓", href: HELP_PATH, description: "最初の設定・CSV 取り込み・要確認・定期とサブスク・書き出しの手順。各画面の「？」からも開ける" },
  { id: "changes", label: "更新履歴", icon: "🆕", href: CHANGES_PATH, description: "いつ何が変わったかと、データの持ち方（保存先・消し方）" },
  { id: "definitions", label: "数字の定義", icon: "📖", href: DEFINITIONS_PATH, description: "支出・収入などの数字をどう数えているかの説明" },
  { id: "requests", label: "要望", icon: "📝", href: "/requests", description: "チャットで送った機能の要望と、その状態（受付・対応中・完了・見送り）を見る" },
  { id: "budget", label: "予算台帳", icon: "📒", href: "/budget", ownerOnly: true, description: "費目ごとの月の予算と使った額を比べる" },
];

/** 本人に見える機能（社長専用は社長だけ） */
export function catalogFor({ isOwner }: { isOwner: boolean }): Feature[] {
  return CATALOG.filter((f) => isOwner || !f.ownerOnly);
}

export const FIXED_FEATURES: Feature[] = CATALOG.filter((f) => f.fixed);

export function findFeature(id: string, { isOwner }: { isOwner: boolean }): Feature | undefined {
  return catalogFor({ isOwner }).find((f) => f.id === id);
}
