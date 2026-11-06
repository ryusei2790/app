/**
 * @file lib/survey/speech.ts
 * @description ブラウザの音声認識（Web Speech API）の薄い包み（mywork#1150 第3弾、Q4 A）。
 * iPhone Safari・Chrome は webkitSpeechRecognition。認識は端末・ブラウザ側（Apple / Google）で行われ、
 * kakebo のサーバーには音声が来ない。使えないブラウザでは null を返し、画面は文字入力だけにする。
 */

export interface SpeechSession {
  stop: () => void;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionCtor = new () => RecognitionLike;

export function getRecognitionCtor(w: unknown = typeof window === "undefined" ? undefined : window): RecognitionCtor | null {
  if (!w) return null;
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

/** マイクのエラーを本人向けの文に */
export function speechErrorMessage(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") return "マイクが許可されていません。文字で答えるか、ブラウザの設定でマイクを許可してください。";
  if (code === "no-speech") return "声が聞き取れませんでした。もう一度押して話してください。";
  if (code === "network") return "音声認識につながりませんでした。文字で答えてください。";
  return "音声認識が止まりました。もう一度押すか、文字で答えてください。";
}

/**
 * 話し始める。onText には確定分＋途中分をつないだ文字が都度来る。止まったら onEnd（最後の文字）。
 * maxSeconds を過ぎたら自動で止める。
 */
export function startSpeech(opts: {
  onText: (text: string) => void;
  onEnd: (text: string) => void;
  onError: (message: string) => void;
  maxSeconds: number;
}): SpeechSession | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "ja-JP";
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = "";
  let interim = "";
  let ended = false;
  rec.onresult = (e) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    opts.onText(finalText + interim);
  };
  rec.onerror = (e) => {
    if (e.error !== "aborted") opts.onError(speechErrorMessage(e.error));
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    opts.onEnd((finalText + interim).trim());
  };
  const timer = setTimeout(() => rec.stop(), opts.maxSeconds * 1000);
  try {
    rec.start();
  } catch {
    clearTimeout(timer);
    return null;
  }
  return { stop: () => rec.stop() };
}
