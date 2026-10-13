/**
 * @file tests/helpers/api.ts
 * @description route handler を HTTP サーバー無しで直接呼ぶための小道具。
 */

import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

export function jsonRequest(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getRequest(path: string): NextRequest {
  return new NextRequest(`${BASE}${path}`);
}

/** 動的ルート（[id]）の第2引数 */
export function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

export async function readJson(res: Response) {
  return (await res.json()) as {
    data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    error?: { code: string; message: string };
  };
}
