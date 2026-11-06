/**
 * @file tests/api/survey-api.test.ts
 * @description 月1回のアンケート API（mywork#1150 第3弾）をローカル Supabase（RLS 有効）で確かめる。
 * - 未ログイン 401
 * - 開くと固定5問の回ができ、2回開いても同じ回
 * - B は A の設問を整えられない・答えられない（404）
 * - 整えるのは1問4回まで（429）。AI はモック
 * - 5問答えると done、done の後は書き換えられない
 * - スキップ → やっぱり答える
 * - 全削除で回・設問・回答が消える
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));
vi.mock("@/lib/date/jst", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date/jst")>();
  return { ...actual, todayJst: () => "2026-11-07" };
});

import { signInAs } from "../helpers/auth-state";
import { getRequest, jsonRequest, readJson } from "../helpers/api";
import { adminSql, closeAdminSql, createTestUser, type TestUser } from "../helpers/local-supabase";
import { prisma } from "@/lib/prisma";
import { setCreateMessageForTest } from "@/lib/menu/chat";
import * as surveyApi from "@/app/api/v1/survey/route";
import * as tidyApi from "@/app/api/v1/survey/tidy/route";
import * as answerApi from "@/app/api/v1/survey/answer/route";
import * as deleteAllApi from "@/app/api/v1/account/delete-all/route";

let A: TestUser;
let B: TestUser;

const reply = {
  id: "m",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [{ type: "tool_use", id: "t", name: "save_answer", input: { text: "整えた文です。", score: 8 } }],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 800, output_tokens: 200 },
} as unknown as Anthropic.Message;

async function open() {
  const res = await surveyApi.GET(getRequest("/api/v1/survey"));
  return { status: res.status, data: res.status === 200 ? (await readJson(res)).data : null };
}
async function post(api: { POST: (r: Request) => Promise<Response> }, path: string, body: unknown) {
  const res = await api.POST(jsonRequest("POST", path, body));
  return { status: res.status, data: res.status === 200 ? (await readJson(res)).data : null };
}

beforeAll(async () => {
  A = await createTestUser("survey-a");
  B = await createTestUser("survey-b");
  setCreateMessageForTest(async () => reply);
});

afterEach(() => signInAs(null));

afterAll(async () => {
  setCreateMessageForTest(null);
  await adminSql("DELETE FROM auth.users WHERE id = ANY($1)", [[A.id, B.id]]);
  await closeAdminSql();
  await prisma.$disconnect();
});

describe("アンケート API", () => {
  it("未ログインは 401", async () => {
    expect((await open()).status).toBe(401);
    expect((await post(tidyApi, "/api/v1/survey/tidy", { question_id: "x", raw_text: "a" })).status).toBe(401);
    expect((await post(answerApi, "/api/v1/survey/answer", {})).status).toBe(401);
  });

  it("開くと固定5問の回ができ、2回開いても同じ", async () => {
    signInAs({ id: A.id, email: A.email });
    const first = await open();
    expect(first.status).toBe(200);
    expect(first.data.month).toBe("2026-11");
    expect(first.data.status).toBe("open");
    expect(first.data.questions).toHaveLength(5);
    const second = await open();
    expect(second.data.questions.map((q: { id: string }) => q.id)).toEqual(first.data.questions.map((q: { id: string }) => q.id));
    const rows = await adminSql("SELECT count(*)::int AS n FROM survey_rounds WHERE user_id = $1", [A.id]);
    expect(rows[0].n).toBe(1);
  });

  it("B は A の設問を整えられない・答えられない", async () => {
    signInAs({ id: A.id, email: A.email });
    const qid = (await open()).data.questions[1].id;
    signInAs({ id: B.id, email: B.email });
    expect((await post(tidyApi, "/api/v1/survey/tidy", { question_id: qid, raw_text: "乗っ取り" })).status).toBe(404);
    expect((await post(answerApi, "/api/v1/survey/answer", { question_id: qid, raw_text: "x", text: "x", input: "text" })).status).toBe(404);
    const rows = await adminSql("SELECT count(*)::int AS n FROM survey_answers WHERE question_id = $1", [qid]);
    expect(rows[0].n).toBe(0);
  });

  it("整えるのは1問4回まで、その後も文字で保存はできる", async () => {
    signInAs({ id: A.id, email: A.email });
    const q = (await open()).data.questions[0];
    for (let i = 0; i < 4; i++) {
      const r = await post(tidyApi, "/api/v1/survey/tidy", { question_id: q.id, raw_text: "えー8点かな" });
      expect(r.status).toBe(200);
      expect(r.data).toMatchObject({ text: "整えた文です。", score: 8, raw_text: "えー8点かな" });
    }
    expect((await post(tidyApi, "/api/v1/survey/tidy", { question_id: q.id, raw_text: "もう一回" })).status).toBe(429);
    const saved = await post(answerApi, "/api/v1/survey/answer", { question_id: q.id, raw_text: "えー8点かな", text: "8点です", score: 8, input: "voice", model: "claude-sonnet-5-5", input_tokens: 800, output_tokens: 200, cost_usd: 999 });
    expect(saved.status).toBe(200);
    const rows = await adminSql<{ score: number; cost_usd: string; input: string }>("SELECT score, cost_usd::text, input FROM survey_answers WHERE question_id = $1", [q.id]);
    expect(rows[0]).toMatchObject({ score: 8, input: "voice", cost_usd: "0.005400" });
  });

  it("満足度の範囲外・空の回答は 422", async () => {
    signInAs({ id: A.id, email: A.email });
    const q = (await open()).data.questions[0];
    expect((await post(answerApi, "/api/v1/survey/answer", { question_id: q.id, raw_text: "x", text: "x", score: 11, input: "text" })).status).toBe(422);
    expect((await post(answerApi, "/api/v1/survey/answer", { question_id: q.id, raw_text: "", text: " ", input: "text" })).status).toBe(422);
    expect((await post(answerApi, "/api/v1/survey/answer", { question_id: q.id, raw_text: "x", text: "x", input: "audio" })).status).toBe(422);
  });

  it("スキップ → やっぱり答える → 5問答えると done、その後は書き換えられない", async () => {
    signInAs({ id: A.id, email: A.email });
    expect((await post(surveyApi, "/api/v1/survey", { action: "skip" })).data.status).toBe("skipped");
    expect((await open()).data.status).toBe("skipped");
    expect((await post(surveyApi, "/api/v1/survey", { action: "resume" })).data.status).toBe("open");
    const qs = (await open()).data.questions;
    let last;
    for (const q of qs.slice(1)) {
      last = await post(answerApi, "/api/v1/survey/answer", { question_id: q.id, raw_text: "文字", text: "文字の回答", input: "text" });
      expect(last.status).toBe(200);
    }
    expect(last!.data.status).toBe("done");
    expect((await post(answerApi, "/api/v1/survey/answer", { question_id: qs[1].id, raw_text: "後から", text: "後から", input: "text" })).status).toBe(404);
    expect((await post(surveyApi, "/api/v1/survey", { action: "skip" })).status).toBe(422);
  });

  it("全削除で回・設問・回答が消える（B の回は残る）", async () => {
    signInAs({ id: B.id, email: B.email });
    await open();
    signInAs({ id: A.id, email: A.email });
    const res = await deleteAllApi.POST(jsonRequest("POST", "/api/v1/account/delete-all", { confirm: "削除" }));
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.deleted.survey_rounds).toBe(1);
    const a = await adminSql("SELECT (SELECT count(*) FROM survey_questions WHERE user_id=$1)::int AS q, (SELECT count(*) FROM survey_answers WHERE user_id=$1)::int AS ans", [A.id]);
    expect(a[0]).toMatchObject({ q: 0, ans: 0 });
    const b = await adminSql("SELECT count(*)::int AS n FROM survey_rounds WHERE user_id = $1", [B.id]);
    expect(b[0].n).toBe(1);
  });
});
