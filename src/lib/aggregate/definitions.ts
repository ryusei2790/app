/**
 * @file lib/aggregate/definitions.ts
 * @description 集計の定義を「計算に使う定数」と「画面に出す文言」の両方で1か所に置く（mywork#425 第1弾、設計書 4-1・4-7）。
 *
 * なぜ1か所か（テスト一覧 D10）:
 *   以前は「支出」が DB 関数・予算台帳・収支一覧の足し算・定期の月換算の4か所で別々に計算され、画面ごとに違う数字が出ていた。
 *   ここにある定義を lib/aggregate/monthly.ts の summarize が使い、ダッシュボード・収支一覧・予算台帳・定義ページ・
 *   （第3弾の）質問の答えが、同じ関数の数字と同じ文言を出す。脚注の文言を他のファイルに直書きするとテストが落ちる。
 *
 * 変えるときは DEFINITIONS_VERSION を上げ、実データの回帰（scripts/regression）の期待値を作り直す（procedures.md）。
 */

/** 定義の版。回帰テストの期待値（scripts/regression/expected.json）と組にして持つ */
export const DEFINITIONS_VERSION = "2026-10-14.1";

/** 定義のページ（未ログインでも読める） */
export const DEFINITIONS_PATH = "/about/definitions";

// ─── 取引の種類（transactions.kind） ────────────────────────────

export const TRANSACTION_KINDS = ["normal", "refund", "transfer", "loan"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** 種類の短い名前（一覧のバッジ・選択肢） */
export const KIND_LABELS: Record<TransactionKind, string> = {
  normal: "通常",
  refund: "返金",
  transfer: "振替",
  loan: "借入・返済",
};

/** 種類の説明（入力フォームの選択肢の補足） */
export const KIND_HELP: Record<TransactionKind, string> = {
  normal: "買ったもの・入ってきたお金。ふつうはこれ",
  refund: "支出の戻り（返品・キャンセル）。収入ではなく、同じカテゴリーの支出から引きます",
  transfer: "口座の間の移動（チャージ・引き出し・立替の精算）。支出にも収入にも入れません",
  loan: "借りたお金（収入の向き）とその返済（支出の向き）。支出にも収入にも入れません",
};

/** 向きと種類を合わせた呼び名（例: 振替（出）・返済） */
export function kindLabel(kind: TransactionKind, type: "income" | "expense"): string {
  switch (kind) {
    case "refund":
      return "返金";
    case "transfer":
      return type === "expense" ? "振替（出）" : "振替（入）";
    case "loan":
      return type === "expense" ? "返済" : "借入";
    default:
      return type === "expense" ? "購入" : "収入";
  }
}

// ─── 計算に使う定数 ─────────────────────────────────────────

/** 「返金が多い月」の条件: 返金が購入の 10% 以上、または 5件以上（定義 8） */
export const REFUND_HEAVY = { ratio: 0.1, count: 5 } as const;

/** メモにこれが含まれる収入は返金候補として「要確認」に出す（定義 1、要確認） */
export const REFUND_KEYWORDS = ["返金", "キャンセル", "払い戻し", "払戻", "返品", "refund"] as const;

// ─── 定義（画面にそのまま出す文言） ────────────────────────────

export interface Definition {
  id: string;
  term: string;
  /** 画面に出す説明 */
  text: string;
  /** 計算（コードがやっていること） */
  formula: string;
  /** どの画面で使うか */
  where: string;
  /** まだ画面に無い定義は、入る弾の番号 */
  phase?: number;
}

export const DEFINITIONS: readonly Definition[] = [
  {
    id: "expense",
    term: "支出",
    text: "買ったもの（購入）の合計から、その月の返金を引いた額。返金は元の支出と同じカテゴリー・費目・固定／変動から引きます",
    formula: "Σ(購入: 支出 × 通常) − Σ(返金: 収入 × 返金)",
    where: "ダッシュボード・収支一覧・予算台帳",
  },
  {
    id: "income",
    term: "収入",
    text: "給料・仕送りなどの入金。返金・振替・借入は入れません",
    formula: "Σ(収入 × 通常)",
    where: "ダッシュボード・収支一覧",
  },
  {
    id: "transfer-loan",
    term: "振替・借入・返済",
    text: "口座の間のお金の移動（チャージ・引き出し・立替の精算）と、借りたお金・その返済。支出にも収入にも入れず、「お金の流れ」でだけ見せます",
    formula: "種類が 振替／借入・返済 の行は、支出・収入のどちらからも除く",
    where: "収支一覧（バッジ）・お金の流れ（第5弾）",
  },
  {
    id: "this-month",
    term: "今月",
    text: "1日から今日まで。今日より後の日付の取引は「予定」として別に出し、合計には入れません。過去の月は月末までです",
    formula: "期間 ＝ [月初, min(今日, 月末)]。日付 > 今日 の行は予定",
    where: "ダッシュボード・収支一覧・予算台帳",
  },
  {
    id: "scheduled",
    term: "予定",
    text: "今日より後の日付で入っている取引（手入力の先払いなど）と、定期のまだ来ていない回。月末の見込み＝今日までの残り＋予定",
    formula: "日付 > 今日 の行 ＋ 定期の未展開の回（今日以降・月末まで）",
    where: "ダッシュボード「予定（今日より後）」",
  },
  {
    id: "fixed-variable",
    term: "固定／変動",
    text: "定期の条件に当てはまる支出が固定、残りが変動。支出の内訳なので、固定＋変動＝支出",
    formula: "lib/fixed/classify.ts の条件（種別・カテゴリー・メモの語句・金額）。返金は元と同じ側から引く",
    where: "ダッシュボード「固定の収入／固定の支出／変動の支出」",
  },
  {
    id: "frames",
    term: "枠の中／枠の外",
    text: "予算台帳の対応表で費目に振り分けた支出が枠の中、家賃・事業など対応表で「枠の外」にしたものが枠の外。これも支出の内訳です",
    formula: "lib/budget/classify.ts の対応表（メモの語句 → カテゴリー）。返金は同じ費目から引く",
    where: "予算台帳（社長だけ）",
  },
  {
    id: "refund-heavy",
    term: "返金が多い月",
    text: "返金が購入の 10% 以上、または 5件以上の月は「返金 N件」を別に出します",
    formula: `返金 ≥ 購入 × ${REFUND_HEAVY.ratio} または 返金の件数 ≥ ${REFUND_HEAVY.count}`,
    where: "ダッシュボード",
  },
  {
    id: "outflow",
    term: "出ていったお金",
    text: "購入＋振替（出）＋返済。「お金の流れ」の画面だけで使う数字で、支出とは別です",
    formula: "Σ(支出 × 通常) ＋ Σ(支出 × 振替) ＋ Σ(支出 × 返済)",
    where: "お金の流れ（第5弾の候補）",
    phase: 5,
  },
  {
    id: "balance",
    term: "残り",
    text: "収入 − 支出（今日まで）。予定を入れた「月末の見込み」は別に出します",
    formula: "収入 − 支出",
    where: "ダッシュボード",
  },
];

/** 画面の脚注（1行）。他のファイルに同じ文言を書かない（D10） */
export const FOOTNOTES = {
  expense: "支出＝購入−返金。振替・借入・返済は入れていません",
  income: "収入＝給料・仕送りなどの入金。返金・振替・借入は入れていません",
  period: "今月は1日〜今日。予定は月末の見込みにだけ入れます",
  pastMonth: "過去の月は月末まで入れています",
  futureMonth: "先の月はまだ来ていないので、全部「予定」です",
  scheduled: "予定＝今日より後の日付の取引と、定期のまだ来ていない回。合計には入れていません",
  scheduledShort: "合計には入れていません。日付になると実績に移ります",
  balance: "残り＝収入−支出（今日まで）",
  fixed: "固定＝定期の条件に当てはまる分、変動＝残り。固定＋変動＝支出",
  memo: "店別・メモ別はメモのある取引だけです",
  listTotal: "この合計はダッシュボードと同じ定義です",
  /** 返金が多い月の1行 */
  refundHeavy: (count: number, amount: string) => `この月は返金が多めです: 返金 ${count}件 ${amount}（支出から引いています）`,
} as const;

/** 分かっている限界（定義ページに書く。Pulse Local の /testing と同じく隠さない） */
export const KNOWN_LIMITS: readonly string[] = [
  "数字は取引に入っているものだけです。入れていない支出は分かりません。店別・メモ別はメモのある取引だけです",
  "返金・振替・借入返済は、本人が種類を付けたものだけ区別します。付けていなければ購入・収入として数えます（「要確認」に候補を出します）",
  "固定／変動は定期の条件で決めています。定期を直すと過去の月もさかのぼって変わります",
  "今月の数字は今日までの実績です。「月末の見込み」は予定を足した参考値で、確定ではありません",
  "重複候補・返金候補は機械的に挙げたものです。消す・直すのは本人が確かめてから行います",
  "質問に数字で答える機能（第3弾以降）では、読み取りが食い違ったときは推測せず数字を出しません",
];

// ─── 何が外に出るか（設計書 4-7。実コードと食い違わないよう S13 で照合） ───────

export interface DataFlowRow {
  operation: string;
  /** ブラウザ・サーバーから外へ出るもの */
  leaves: string;
  /** 経由 */
  via: string;
  /** どこに残るか */
  storedAt: string;
  /** 外部の AI 提供元 */
  externalAi: string;
  /** コードにある送信先ホスト（文字列リテラルの https://…）。S13 で突き合わせる */
  hosts: readonly string[];
  /** まだ無い機能なら true */
  planned?: boolean;
}

export const DATA_FLOW: readonly DataFlowRow[] = [
  {
    operation: "ログイン",
    leaves: "メールアドレス・パスワード",
    via: "Supabase Auth（東京）",
    storedAt: "Supabase（東京）。新規登録は止めています",
    externalAi: "—",
    hosts: [],
  },
  {
    operation: "画面の表示・取引の読み書き",
    leaves: "セッションの Cookie、取引の中身",
    via: "Vercel の関数（東京 hnd1）→ Supabase（東京、本人の行だけ読める RLS）",
    storedAt: "Supabase だけ。関数は保存しない。ログに金額を出さない",
    externalAi: "—",
    hosts: [],
  },
  {
    operation: "CSV 取り込み",
    leaves: "CSV の本文",
    via: "Vercel の関数 → Supabase",
    storedAt: "取引の行として Supabase。CSV ファイルは保存しない。履歴はファイル名と件数だけ",
    externalAi: "—",
    hosts: [],
  },
  {
    operation: "レシート読み取り",
    leaves: "縮小した写真（位置情報などの EXIF は外す）",
    via: "Vercel の関数 → OpenRouter または Anthropic（米国）",
    storedAt: "写真は保存しない。記録は件数・トークン数だけ",
    externalAi: "RECEIPT_PARSER で選ぶ。未設定なら何も送らない（本番は OpenRouter→Anthropic（Claude Haiku 5.5））",
    hosts: ["openrouter.ai", "api.anthropic.com"],
  },
  {
    operation: "ドル建ての定期を円に直す",
    leaves: "日付だけ（金額・名前は送らない）",
    via: "Vercel の関数 → Frankfurter（欧州中央銀行の参照レート）",
    storedAt: "相場は保存しない。円に直した金額とレートを取引のメモに残す",
    externalAi: "—",
    hosts: ["api.frankfurter.dev"],
  },
  {
    operation: "書き出し（CSV・完全形式のバックアップ）",
    leaves: "—（本人の行を読んでブラウザに返すだけ）",
    via: "Vercel の関数 → ブラウザ",
    storedAt: "本人の端末にファイルとして保存。サーバーには残さない",
    externalAi: "—",
    hosts: [],
  },
  {
    operation: "スプシに書き出す（押したときだけ）",
    leaves: "取引全件（日付・収支・金額・カテゴリー・メモ）と月次集計",
    via: "ブラウザ → 本人の Google（許可はこのアプリが作ったファイルだけ＝drive.file）。サーバーは Google と通信しない",
    storedAt: "本人の Google ドライブに新しいスプレッドシート。Google のトークンは画面のメモリだけで保存しない",
    externalAi: "—",
    hosts: ["accounts.google.com", "sheets.googleapis.com", "www.googleapis.com"],
  },
  {
    operation: "復元・全削除・取り込みの取り消し",
    leaves: "完全形式のファイルの中身（復元のときだけ）・確認語",
    via: "Vercel の関数 → Supabase（本人の行だけ）",
    storedAt: "復元は行として Supabase（ファイルは保存しない）。消した行は戻せない（戻すのは本人のバックアップから）",
    externalAi: "—",
    hosts: [],
  },
  {
    operation: "定期の収入・支出の展開（毎日）",
    leaves: "—（サーバーの中だけ）",
    via: "Vercel Cron → 関数 → Supabase",
    storedAt: "Supabase",
    externalAi: "—",
    hosts: [],
  },
  {
    operation: "解析・テレメトリ・クラッシュログ",
    leaves: "無し（アプリに解析のコードは無い）",
    via: "Vercel の標準のアクセスログ（URL・IP）は Vercel 側に残る",
    storedAt: "Vercel",
    externalAi: "—",
    hosts: [],
  },
  {
    operation: "聞く（第3弾・第4弾、まだ無い）",
    leaves: "質問文・語彙（カテゴリー名・費目名・定期の名前）・今日の日付",
    via: "Vercel の関数 → Anthropic（米国。学習に使わない）",
    storedAt: "質問文は保存しない。回数とトークン数だけ",
    externalAi: "Claude Haiku 5.5（本人の設定で OFF にできる）",
    hosts: ["api.anthropic.com"],
    planned: true,
  },
];

/** どの操作でも外に出さないもの */
export const NOT_SENT: readonly string[] = [
  "金額・日付・取引の行（AI 提供元へは送らない）",
  "メモの本文（AI 提供元へは送らない）",
  "レシートの写真の保存",
  "CSV ファイルの保存",
];

/** 関数の実行場所（論点5。vercel.json の regions） */
export const FUNCTION_REGION = {
  id: "hnd1",
  label: "東京（hnd1）",
  note: "vercel.json の regions で指定。それまでは既定の米国東部（iad1）で動いていました（2026-10-14 に応答ヘッダで確認）",
} as const;
