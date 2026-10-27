/**
 * @file tests/unit/lp-utm.test.ts
 * @description 着地ページの UTM・visitor・メール・CSV の検証（mywork#878）
 */

import { describe, expect, it } from "vitest";
import {
  cleanUtmValue, csvCell, isBotUserAgent, isVisitorId, nextUtmCookie, normalizeEmail, parseUtmCookie, pickUtm, referrerHost,
} from "@/lib/lp/utm";

describe("UTM", () => {
  it("英数と _-. 以外を捨て、100 文字で切る", () => {
    expect(cleanUtmValue("kakebo_test-2611.a")).toBe("kakebo_test-2611.a");
    expect(cleanUtmValue("<script>a</script>")).toBe("scriptascript");
    expect(cleanUtmValue("x".repeat(150))).toHaveLength(100);
  });
  it("空・型違いは無かったことにする", () => {
    expect(cleanUtmValue("")).toBeUndefined();
    expect(cleanUtmValue("日本語")).toBeUndefined();
    expect(cleanUtmValue(3)).toBeUndefined();
  });
  it("クエリから4つだけ取る", () => {
    const q = new URLSearchParams("utm_source=instagram&utm_medium=paid_social&utm_campaign=kakebo_test_2611&utm_content=a&fbclid=zzz");
    expect(pickUtm(q)).toEqual({ utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "kakebo_test_2611", utm_content: "a" });
  });
  it("cookie は上書きしない（最初に来た広告が正）", () => {
    expect(nextUtmCookie({ utm_content: "a" }, { utm_content: "b" })).toBeNull();
    expect(nextUtmCookie({}, {})).toBeNull();
    expect(parseUtmCookie(nextUtmCookie({}, { utm_content: "b" }) ?? undefined)).toEqual({ utm_content: "b" });
  });
  it("壊れた cookie は空", () => {
    expect(parseUtmCookie("{bad")).toEqual({});
    expect(parseUtmCookie(JSON.stringify({ utm_content: "a;drop" }))).toEqual({ utm_content: "adrop" });
  });
});

describe("visitor・ボット・referrer", () => {
  it("UUID だけを visitor として受ける", () => {
    expect(isVisitorId(crypto.randomUUID())).toBe(true);
    expect(isVisitorId("abc")).toBe(false);
  });
  it("ボットと UA 無しは数えない", () => {
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent("Googlebot/2.1")).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Instagram 350")).toBe(false);
  });
  it("referrer はホスト名だけ", () => {
    expect(referrerHost("https://l.instagram.com/?u=secret")).toBe("l.instagram.com");
    expect(referrerHost("not a url")).toBeUndefined();
  });
});

describe("メール・CSV", () => {
  it("小文字にして形を確かめる", () => {
    expect(normalizeEmail("  Foo+Kakebo@Example.COM ")).toBe("foo+kakebo@example.com");
    expect(normalizeEmail("foo@bar")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
  it("CSV の数式・区切り文字を無害化する", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });
});
