/**
 * @file tests/unit/mcp.test.ts
 * @description AI 接続（mywork#882）の DB を使わない部品の単体テスト。
 *   U1 Bearer の取り出し・JWT の足切り（期限・発行元・client_id）
 *   U2 案内（protected resource metadata）と WWW-Authenticate・origin の組み立て
 *   U3 カテゴリ名のあいまい一致
 *   U4 月の読み取りと足し算
 *   U5 ログイン後の戻り先（オープンリダイレクトにしない）
 *   U6 同意画面の authorization_id の形
 */

import { describe, expect, it } from "vitest";
import { decodeJwtPayload, prefilterToken, readBearer } from "@/lib/mcp/token";
import { expectedIssuer, protectedResourceMetadata, requestOrigin, resourceMetadataUrl, wwwAuthenticate } from "@/lib/mcp/metadata";
import { addMonths, matchByName, normalizeName, parseMonth } from "@/lib/mcp/tools";
import { safeNextPath } from "@/lib/safe-next";
import { isAuthorizationId } from "@/app/oauth/consent/authorization-id";

const ISS = "https://example.supabase.co/auth/v1";
const SUB = "11111111-2222-4333-8444-555555555555";
const NOW = 1_800_000_000;

/** 署名は見ないので、本体だけそれらしい JWT を作る */
function jwt(payload: Record<string, unknown>) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "ES256" })}.${b(payload)}.sig`;
}
const good = { sub: SUB, exp: NOW + 600, iss: ISS, role: "authenticated", client_id: "c-1" };

describe("U1 トークン", () => {
  it("Bearer だけ取り出す", () => {
    expect(readBearer("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(readBearer("bearer abc")).toBe("abc");
    expect(readBearer(null)).toBeNull();
    expect(readBearer("Basic abc")).toBeNull();
    expect(readBearer("Bearer a b")).toBeNull();
  });

  it("JWT の本体を読める。壊れていれば null", () => {
    expect(decodeJwtPayload(jwt({ a: 1 }))).toEqual({ a: 1 });
    expect(decodeJwtPayload("x.y")).toBeNull();
    expect(decodeJwtPayload("a.!!!.c")).toBeNull();
  });

  it("足切り: 正しいものだけ通し、client_id を返す", () => {
    expect(prefilterToken(jwt(good), ISS, NOW)).toEqual({ ok: true, sub: SUB, clientId: "c-1" });
  });

  it("足切り: 期限切れ・他の発行元・client_id 無し（画面のログイン）・role 違い・sub が UUID でない", () => {
    expect(prefilterToken(jwt({ ...good, exp: NOW }), ISS, NOW)).toEqual({ ok: false, reason: "expired" });
    expect(prefilterToken(jwt({ ...good, iss: "https://evil.example/auth/v1" }), ISS, NOW)).toEqual({ ok: false, reason: "issuer" });
    expect(prefilterToken(jwt({ ...good, client_id: undefined }), ISS, NOW)).toEqual({ ok: false, reason: "not_oauth" });
    expect(prefilterToken(jwt({ ...good, role: "service_role" }), ISS, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(prefilterToken(jwt({ ...good, sub: "admin" }), ISS, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("U2 案内", () => {
  it("認可サーバーは Supabase Auth、resource は /api/mcp", () => {
    const m = protectedResourceMetadata("https://kakebo.example", "https://ref.supabase.co/");
    expect(m.resource).toBe("https://kakebo.example/api/mcp");
    expect(m.authorization_servers).toEqual(["https://ref.supabase.co/auth/v1"]);
    expect(expectedIssuer("https://ref.supabase.co")).toBe("https://ref.supabase.co/auth/v1");
  });

  it("401 の見出しは ASCII だけで、案内の URL を指す", () => {
    const h = wwwAuthenticate("https://kakebo.example", true);
    expect(h).toContain(`resource_metadata="${resourceMetadataUrl("https://kakebo.example")}"`);
    expect(h).toContain('error="invalid_token"');
    expect(/^[\x20-\x7e]*$/.test(h)).toBe(true);
  });

  it("origin は Host（Vercel では x-forwarded-host）から。変な値なら request.url", () => {
    const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/mcp", { headers });
    expect(requestOrigin(req({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
    expect(requestOrigin(req({ "x-forwarded-host": "kakebo.example", "x-forwarded-proto": "https" }))).toBe("https://kakebo.example");
    expect(requestOrigin(req({ host: "evil.example/x?" }))).toBe("http://localhost:3000");
  });
});

describe("U3 名前のあいまい一致", () => {
  const cats = [
    { name: "食費", mine: false },
    { name: "外食", mine: false },
    { name: "日用品", mine: false },
    { name: "日用品", mine: true },
    { name: "ＡＩ課金", mine: true },
  ];
  it("完全一致 → 部分一致の順。全角半角・大文字小文字は揃える", () => {
    expect(matchByName(cats, "外食")).toMatchObject({ ok: true, item: { name: "外食" } });
    expect(matchByName(cats, "食費代")).toMatchObject({ ok: true, item: { name: "食費" } });
    expect(matchByName(cats, "ai課金")).toMatchObject({ ok: true, item: { name: "ＡＩ課金" } });
    expect(normalizeName(" Ａｂｃ ")).toBe("abc");
  });
  it("複数当たれば決めずに候補を返す", () => {
    const r = matchByName(cats, "食");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates.sort()).toEqual(["外食", "食費"].sort());
  });
  it("同じ名前が共通と自分にあれば自分のもの", () => {
    expect(matchByName(cats, "日用品", (c) => c.mine)).toMatchObject({ ok: true, item: { mine: true } });
  });
  it("当たらなければ全部を候補に", () => {
    const r = matchByName(cats, "旅行");
    expect(r.ok).toBe(false);
  });
});

describe("U4 月", () => {
  it("省略は今月、形が違えば null", () => {
    expect(parseMonth(undefined, "2026-10-28")).toBe("2026-10");
    expect(parseMonth("2026-09", "2026-10-28")).toBe("2026-09");
    expect(parseMonth("2026-13", "2026-10-28")).toBeNull();
    expect(parseMonth("2026/10", "2026-10-28")).toBeNull();
  });
  it("年をまたいで足し引きできる", () => {
    expect(addMonths("2026-10", 3)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", -5)).toBe("2026-05");
  });
});

describe("U5 ログイン後の戻り先", () => {
  it("中のパスはそのまま", () => {
    expect(safeNextPath("/oauth/consent?authorization_id=abc")).toBe("/oauth/consent?authorization_id=abc");
    expect(safeNextPath("/settings#ai")).toBe("/settings#ai");
  });
  it("外へ出るものは既定の /calendar に", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "@evil.example", "evil", "", null, undefined, "/\nx", "javascript:alert(1)"]) {
      expect(safeNextPath(bad as string)).toBe("/calendar");
    }
  });
});

describe("U6 authorization_id", () => {
  it("英数字と - _ だけ", () => {
    expect(isAuthorizationId("atw3l5o5prpv4k5gdbvea6wngydsli2q")).toBe(true);
    expect(isAuthorizationId("a&b=c")).toBe(false);
    expect(isAuthorizationId("")).toBe(false);
    expect(isAuthorizationId(undefined)).toBe(false);
  });
});
