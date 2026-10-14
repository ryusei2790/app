/**
 * @file app/(dashboard)/fixed-costs/page.tsx
 * @description 定期の収入・支出（給料・仕送り・家賃・サブスクなど）の管理画面（Server Component）。
 */

import { FixedCostView } from "@/components/fixed-costs/FixedCostView";

export default function FixedCostsPage() {
  return <FixedCostView />;
}
