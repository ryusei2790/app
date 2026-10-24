/**
 * @file components/help/HelpLink.tsx
 * @description 画面の見出しの横に置く「？」（mywork#764 ①）。使い方の該当の節を開く。
 */

import Link from "next/link";
import { HELP_PATH } from "@/lib/help/sections";

export function HelpLink({ section }: { section: string }) {
  return (
    <Link
      href={`${HELP_PATH}#${section}`}
      aria-label="使い方"
      title="使い方"
      data-testid="help-link"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-300 text-sm font-bold text-gray-500 hover:bg-gray-100"
    >
      ？
    </Link>
  );
}
