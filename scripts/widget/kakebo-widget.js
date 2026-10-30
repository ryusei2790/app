// kakebo ウィジェット（Scriptable 用）— 今月の収入・支出・合計を iPhone のホームに出す（mywork#967）
// 貼り付け手順: docs/2026-10-30_iPhoneウィジェット_貼り付け手順.md
// トークンはこのファイルに書かない。初回に Scriptable アプリで実行すると入力欄が出て、iPhone の Keychain に保存する。

const API_URL = "https://kakebo-omega.vercel.app/api/v1/widget/summary";
const KEY = "kakebo_widget_token";

const COLORS = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  text: Color.dynamic(new Color("#1c1c1e"), new Color("#f2f2f7")),
  sub: Color.dynamic(new Color("#8e8e93"), new Color("#98989f")),
  income: new Color("#34a853"),
  expense: new Color("#ea4335"),
};

async function askToken() {
  const a = new Alert();
  a.title = "kakebo のトークン";
  a.message = "Vercel に設定した WIDGET_TOKEN を貼ってください（Keychain に保存します）";
  a.addSecureTextField("トークン", "");
  a.addAction("保存");
  a.addCancelAction("やめる");
  if ((await a.present()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t || null;
}

async function getToken() {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  return config.runsInApp ? await askToken() : null;
}

const yen = (n) => (n < 0 ? "-¥" : "¥") + Math.abs(n).toLocaleString("ja-JP");

async function fetchSummary(token) {
  const req = new Request(API_URL);
  req.headers = { Authorization: `Bearer ${token}` };
  req.timeoutInterval = 15;
  const body = await req.loadJSON();
  if (req.response.statusCode === 401) throw new Error("トークンが違います");
  if (req.response.statusCode !== 200) throw new Error(`取得に失敗（${req.response.statusCode}）`);
  return body.data;
}

function row(stack, label, value, color, size) {
  const r = stack.addStack();
  r.centerAlignContent();
  const l = r.addText(label);
  l.font = Font.mediumSystemFont(size - 2);
  l.textColor = COLORS.sub;
  r.addSpacer();
  const v = r.addText(yen(value));
  v.font = Font.semiboldRoundedSystemFont(size);
  v.textColor = color;
  v.minimumScaleFactor = 0.6;
  v.lineLimit = 1;
}

function build(data, errorMessage) {
  const small = config.widgetFamily !== "medium";
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(14, 14, 14, 14);
  w.url = "https://kakebo-omega.vercel.app/";
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  const head = w.addStack();
  const title = head.addText(data ? `${Number(data.month.slice(5))}月の収支` : "家計簿");
  title.font = Font.boldSystemFont(small ? 13 : 15);
  title.textColor = COLORS.text;
  head.addSpacer();
  if (data && !small) {
    const d = head.addText(`${Number(data.today.slice(5, 7))}/${Number(data.today.slice(8))} 時点`);
    d.font = Font.systemFont(11);
    d.textColor = COLORS.sub;
  }
  w.addSpacer();

  if (!data) {
    const e = w.addText(errorMessage);
    e.font = Font.systemFont(12);
    e.textColor = COLORS.sub;
    w.addSpacer();
    return w;
  }

  if (small) {
    const b = w.addText(yen(data.balance));
    b.font = Font.boldRoundedSystemFont(24);
    b.textColor = data.balance < 0 ? COLORS.expense : COLORS.text;
    b.minimumScaleFactor = 0.5;
    b.lineLimit = 1;
    w.addSpacer(6);
    row(w, "収入", data.income, COLORS.income, 13);
    w.addSpacer(2);
    row(w, "支出", data.expense, COLORS.expense, 13);
  } else {
    const body = w.addStack();
    const left = body.addStack();
    left.layoutVertically();
    const cap = left.addText("合計");
    cap.font = Font.mediumSystemFont(12);
    cap.textColor = COLORS.sub;
    const b = left.addText(yen(data.balance));
    b.font = Font.boldRoundedSystemFont(30);
    b.textColor = data.balance < 0 ? COLORS.expense : COLORS.text;
    b.minimumScaleFactor = 0.5;
    b.lineLimit = 1;
    body.addSpacer(16);
    const right = body.addStack();
    right.layoutVertically();
    right.size = new Size(150, 0);
    row(right, "収入", data.income, COLORS.income, 16);
    right.addSpacer(8);
    row(right, "支出", data.expense, COLORS.expense, 16);
  }
  w.addSpacer();
  return w;
}

let data = null;
let message = "";
const token = await getToken();
if (!token) {
  message = "Scriptable で一度開いてトークンを入れてください";
} else {
  try {
    data = await fetchSummary(token);
  } catch (e) {
    message = e.message;
    if (config.runsInApp && message === "トークンが違います") {
      Keychain.remove(KEY);
      message += "（もう一度実行して入れ直してください）";
    }
  }
}

const widget = build(data, message);
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
