/**
 * @file lib/nav.ts
 * @description サイドバー・スマホのメニューの形（mywork#573 から、中身は lib/menu/catalog.ts の固定5つ＋本人のマイメニュー）。
 * 社長専用の項目（予算台帳）は社長にだけ出す（S6）。画面で隠すのは見た目のためで、
 * 守りの本体は API（requireOwner）と画面の notFound()。
 *
 * ホーム（/start）への戻り道（mywork#1238）: 左上のアプリ名・メニューの先頭「ホーム」・スマホ下のタブの3か所から戻れる。
 * ホームはカタログ（lib/menu/catalog.ts）には入れない。カタログはチャットが並べ替える「機能」の一覧で、
 * ホームは機能ではなく戻り先なので、メニューの外枠（NavList・MobileTabBar）が必ず出す。
 */

import type { MenuItem } from "@/lib/menu/layout";

export type NavItem = MenuItem;

export interface NavMenu {
  fixed: NavItem[];
  mine: NavItem[];
}

/** ホーム（標準3つの画面、mywork#1150）。ログイン後の既定の戻り先（lib/safe-next.ts の DEFAULT_NEXT）と同じ */
export const HOME_PATH = "/start";

export const HOME_ITEM: NavItem = { id: "start", href: HOME_PATH, label: "ホーム", icon: "🏠" };

/**
 * スマホの下のタブ（mywork#1238）。ホーム＋標準3つ＋チャットの5つで、どの画面からも1回で押せる。
 * 中身は固定（チャットで並べ替える拡張機能は上の「メニュー」に出す）。
 * 標準3つはカタログから取るので、名前・アイコンを変えたときにタブもそろう。
 */
export function tabItems(fixed: NavItem[]): NavItem[] {
  const pick = (id: string) => fixed.find((i) => i.id === id);
  const closing = pick("closing");
  // 375px に5つ並べるので「今月の決算」は短く（1つ 75px）
  const tabs = [HOME_ITEM, pick("manual"), pick("receipt"), closing && { ...closing, label: "決算" }, pick("chat")];
  return tabs.filter((t): t is NavItem => Boolean(t));
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
