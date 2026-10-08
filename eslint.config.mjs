import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // DB には lib/db.ts の withUserDb（RLS が効く）経由でだけ触る。
  // route や画面から管理者接続の Prisma を直接使うと RLS を素通りするので禁止する（#229 S1〜S3）。
  // 例外の lib/admin-db.ts は「全員分を横断する定期処理・回数制限」だけを置く管理者専用の窓口。
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db.ts", "src/lib/prisma.ts", "src/lib/admin-db.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message: "DB には @/lib/db の withUserDb() 経由で触ってください（RLS を効かせるため）。",
            },
          ],
          patterns: [
            {
              group: ["**/lib/prisma", "**/generated/prisma", "@/generated/prisma"],
              message: "DB には @/lib/db の withUserDb() 経由で触ってください（RLS を効かせるため）。",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma が生成するコード（自分で書いたものではないので lint しない）
    "src/generated/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
