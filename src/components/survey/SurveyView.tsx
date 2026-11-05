/**
 * @file components/survey/SurveyView.tsx
 * @description 月1回のアンケート（mywork#1150 第3弾）。1問ずつ、🎙 で話す（ブラウザの音声認識）か文字で答える →
 * AI が整えた文を見せる →［OK］で保存／［言い直す］／［文字で直す］。5問そろったら終わり。
 *
 * 音声はブラウザの中で文字になり、サーバーには文字だけを送る（音声は保存しない・送らない）。
 * 途中でやめても、次に開くと答えていない最初の設問から続く。
 */

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getRecognitionCtor, startSpeech, type SpeechSession } from "@/lib/survey/speech";

interface Answer {
  text: string;
  raw_text: string;
  score: number | null;
  input: "voice" | "text";
}

interface Question {
  id: string;
  position: number;
  text: string;
  kind: string;
  tidy_left: number;
  answer: Answer | null;
}

interface Survey {
  month: string;
  status: "open" | "done" | "skipped";
  questions: Question[];
  consent: string;
  voice_max_seconds: number;
}

interface Draft {
  raw_text: string;
  text: string;
  score: number | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "うまくいきませんでした");
  return j.data;
}

function monthLabel(m: string) {
  const [y, mm] = m.split("-");
  return `${y}年${Number(mm)}月`;
}

export function SurveyView() {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceOk, setVoiceOk] = useState(true);
  const session = useRef<SpeechSession | null>(null);

  useEffect(() => {
    api<Survey>("/api/v1/survey")
      .then((s) => {
        setSurvey(s);
        const first = s.questions.findIndex((q) => !q.answer);
        setIndex(first === -1 ? 0 : first);
        const can = getRecognitionCtor() !== null;
        setVoiceOk(can);
        if (!can) setMode("text");
      })
      .catch((e: Error) => setNotice(e.message));
    return () => session.current?.stop();
  }, []);

  if (!survey) return <p className="p-6 text-center text-sm text-gray-500">{notice ?? "読み込み中…"}</p>;

  const q = survey.questions[index];
  const answered = survey.questions.filter((x) => x.answer).length;
  const total = survey.questions.length;

  function resetInput() {
    setHeard("");
    setTyped("");
    setDraft(null);
    setEditing(false);
    setNotice(null);
  }

  async function tidy(raw: string, input: "voice" | "text") {
    if (!raw.trim()) return setNotice("回答が空です。話すか、文字で書いてください。");
    setBusy(true);
    setNotice(null);
    try {
      const d = await api<Draft>("/api/v1/survey/tidy", { question_id: q.id, raw_text: raw });
      setDraft(d);
      setMode(input);
      setSurvey((s) => s && { ...s, questions: s.questions.map((x) => (x.id === q.id ? { ...x, tidy_left: Math.max(0, x.tidy_left - 1) } : x)) });
    } catch (e) {
      // 整える回数の上限・AI の失敗でも、文字のまま確認して保存できるようにする
      setDraft({ raw_text: raw, text: raw, score: null, model: null, input_tokens: 0, output_tokens: 0 });
      setNotice(e instanceof Error ? e.message : "整えられませんでした。そのままの文で保存できます。");
    } finally {
      setBusy(false);
    }
  }

  function startListening() {
    setNotice(null);
    setHeard("");
    setDraft(null);
    const s = startSpeech({
      maxSeconds: survey!.voice_max_seconds,
      onText: setHeard,
      onError: (m) => setNotice(m),
      onEnd: (text) => {
        session.current = null;
        setListening(false);
        if (text) void tidy(text, "voice");
      },
    });
    if (!s) {
      setVoiceOk(false);
      setMode("text");
      return setNotice("このブラウザでは音声で答えられません。文字で答えてください。");
    }
    session.current = s;
    setListening(true);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const next = await api<Omit<Survey, "consent" | "voice_max_seconds">>("/api/v1/survey/answer", {
        question_id: q.id,
        raw_text: draft.raw_text,
        text: draft.text,
        score: draft.score,
        input: mode,
        model: draft.model,
        input_tokens: draft.input_tokens,
        output_tokens: draft.output_tokens,
      });
      setSurvey((s) => s && { ...s, ...next });
      resetInput();
      const after = next.questions.findIndex((x, i) => i > index && !x.answer);
      const any = next.questions.findIndex((x) => !x.answer);
      setIndex(after !== -1 ? after : any !== -1 ? any : index);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await api("/api/v1/survey", { action: "skip" });
      setSurvey((s) => s && { ...s, status: "skipped" });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "スキップできませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    await api("/api/v1/survey", { action: "resume" }).catch(() => null);
    setSurvey((s) => s && { ...s, status: "open" });
  }

  const header = (
    <h2 className="text-xl font-bold text-gray-900">
      🎙 {monthLabel(survey.month)}のアンケート
    </h2>
  );

  if (survey.status === "done") {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6" data-testid="survey-done">
        {header}
        <p className="rounded-xl bg-green-50 p-4 text-sm text-green-800">今月は終わりです。ありがとうございました。いただいた声は次の改善に使います。</p>
        <ol className="space-y-2">
          {survey.questions.map((x) => (
            <li key={x.id} className="rounded-xl bg-white p-3 text-sm shadow-sm">
              <p className="text-xs text-gray-500">
                Q{x.position}. {x.text}
              </p>
              <p className="mt-1 text-gray-800">
                {x.answer?.score !== null && x.answer?.score !== undefined && <span className="mr-1 font-bold">{x.answer.score}点</span>}
                {x.answer?.text}
              </p>
            </li>
          ))}
        </ol>
        <Link href="/start" className="block text-center text-sm text-blue-600 hover:underline">
          ホームへ戻る
        </Link>
      </div>
    );
  }

  if (survey.status === "skipped") {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6" data-testid="survey-skipped">
        {header}
        <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-700">今月はスキップしました。来月またお願いします。</p>
        <button type="button" onClick={resume} className="w-full rounded-xl border border-blue-600 py-3 text-sm font-bold text-blue-600">
          やっぱり答える
        </button>
        <Link href="/start" className="block text-center text-sm text-blue-600 hover:underline">
          ホームへ戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      {header}
      <p className="text-xs text-gray-500" data-testid="survey-consent">
        5問・約3分。{survey.consent}
      </p>

      <div className="flex gap-1" aria-label={`${answered}/${total}問 回答済み`}>
        {survey.questions.map((x, i) => (
          <button
            key={x.id}
            type="button"
            aria-label={`Q${x.position}${x.answer ? "（回答済み）" : ""}`}
            onClick={() => {
              session.current?.stop();
              resetInput();
              setIndex(i);
            }}
            className={`h-2 flex-1 rounded-full ${i === index ? "bg-blue-600" : x.answer ? "bg-blue-300" : "bg-gray-200"}`}
          />
        ))}
      </div>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="survey-question">
        <p className="text-xs font-semibold text-gray-500">
          Q{q.position} / {total}
        </p>
        <p className="text-base font-bold text-gray-900">{q.text}</p>
        {q.answer && !draft && (
          <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-900">
            保存済み: {q.answer.score !== null && `${q.answer.score}点 `}
            {q.answer.text}
          </p>
        )}

        {!draft && (
          <>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                disabled={!voiceOk}
                onClick={() => setMode("voice")}
                className={`rounded-full px-3 py-1 ${mode === "voice" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"} disabled:opacity-40`}
              >
                🎙 声で答える
              </button>
              <button
                type="button"
                onClick={() => {
                  session.current?.stop();
                  setMode("text");
                }}
                className={`rounded-full px-3 py-1 ${mode === "text" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
              >
                ⌨️ 文字で答える
              </button>
            </div>

            {mode === "voice" ? (
              <div className="space-y-2">
                <button
                  type="button"
                  data-testid="survey-mic"
                  disabled={busy}
                  onClick={() => (listening ? session.current?.stop() : startListening())}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold text-white ${listening ? "animate-pulse bg-red-500" : "bg-blue-600"} disabled:bg-gray-300`}
                >
                  {listening ? "⏹ 話し終わったら押す" : busy ? "整えています…" : "🎙 押して話す"}
                </button>
                <p className="text-center text-xs text-gray-500">最大{survey.voice_max_seconds}秒。音声は保存しません</p>
                {heard && <p className="rounded-lg bg-gray-50 p-2 text-sm text-gray-700">{heard}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  data-testid="survey-text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder="ここに書いてください"
                  className="w-full rounded-lg border border-gray-300 p-2 text-base"
                />
                <button
                  type="button"
                  data-testid="survey-text-submit"
                  disabled={busy || !typed.trim()}
                  onClick={() => tidy(typed, "text")}
                  className="w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:bg-gray-300"
                >
                  {busy ? "整えています…" : "これで答える"}
                </button>
              </div>
            )}
          </>
        )}

        {draft && (
          <div className="space-y-2" data-testid="survey-draft">
            <p className="text-xs text-gray-500">こう聞き取りました:</p>
            {editing ? (
              <textarea
                data-testid="survey-draft-edit"
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                rows={4}
                maxLength={1000}
                className="w-full rounded-lg border border-gray-300 p-2 text-base"
              />
            ) : (
              <p className="rounded-lg bg-blue-50 p-3 text-sm text-gray-900">{draft.text}</p>
            )}
            {q.kind === "satisfaction" && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                満足度
                <select
                  data-testid="survey-score"
                  value={draft.score === null ? "" : String(draft.score)}
                  onChange={(e) => setDraft({ ...draft, score: e.target.value === "" ? null : Number(e.target.value) })}
                  className="rounded border border-gray-300 px-2 py-1"
                >
                  <option value="">—</option>
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
                点
              </label>
            )}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                data-testid="survey-ok"
                disabled={busy || !draft.text.trim()}
                onClick={save}
                className="rounded-xl bg-blue-600 py-3 text-sm font-bold text-white disabled:bg-gray-300"
              >
                OK
              </button>
              <button
                type="button"
                disabled={busy || q.tidy_left <= 0}
                onClick={() => {
                  setDraft(null);
                  setEditing(false);
                  setHeard("");
                }}
                className="rounded-xl border border-gray-300 py-3 text-sm text-gray-700 disabled:opacity-40"
              >
                言い直す
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
                className="rounded-xl border border-gray-300 py-3 text-sm text-gray-700"
              >
                文字で直す
              </button>
            </div>
            <p className="text-right text-xs text-gray-400">言い直しはあと{q.tidy_left}回</p>
          </div>
        )}
      </section>

      {notice && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{notice}</p>}

      <div className="flex justify-between text-sm">
        <button type="button" onClick={skip} disabled={busy} className="text-gray-500 hover:underline">
          今月はスキップ
        </button>
        <Link href="/start" className="text-blue-600 hover:underline">
          あとで続ける
        </Link>
      </div>
    </div>
  );
}
