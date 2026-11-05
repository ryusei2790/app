/**
 * @file app/(dashboard)/extensions/page.tsx
 * @description 拡張機能の一覧（mywork#1150）。チャットを使わなくても ON/OFF・並べ替えができる。
 */

import { getAuthUser } from "@/lib/api-helpers";
import { isOwner } from "@/lib/features";
import { catalogFor } from "@/lib/menu/catalog";
import { ExtensionsView } from "@/components/extensions/ExtensionsView";

export default async function ExtensionsPage() {
  const user = await getAuthUser();
  const features = catalogFor({ isOwner: isOwner(user) })
    .filter((f) => !f.fixed)
    .map(({ id, label, icon, description }) => ({ id, label, icon, description }));
  return <ExtensionsView features={features} />;
}
