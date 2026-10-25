#!/bin/bash
# 家計簿の見張り（launchd: com.ryusei.kakebo-monitor、毎日 12:30。mywork#764 ④）。
# 次の3つを見て、駄目なものごとに俺待ちの Issue を1本だけ立てる（同じ題名が開いていれば立てない）:
#   1. 本番の /api/health … DB に届くか・毎日の定期実行（0:05 JST）が今日の分まで済んでいるか
#      （毎日 DB を1回読むので、Supabase 無料枠の「7日アクセスなしで休止」の予防も兼ねる）
#   2. app リポの main の Vercel デプロイ … 最後のデプロイが失敗していないか（GitHub の commit status）
#   3. 定期バックアップ … ログの最後の実行が失敗していないか（8日止まりは check-fresh.sh が見る）
# 鍵は増やさない（health はログイン不要で真偽だけ返す、gh は Mac のログイン済みのもの）。手動: bash check.sh
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
URL="${KAKEBO_URL:-https://kakebo-omega.vercel.app}"
LOG="${KAKEBO_MONITOR_LOG:-$HOME/Library/Logs/kakebo-monitor.log}"
BLOG="${KAKEBO_BACKUP_LOG:-$HOME/Library/Logs/kakebo-backup.log}"
WAIT="${GH_WAIT:-$HOME/Mywork/.claude/scripts/gh-wait.sh}"
exec >>"$LOG" 2>&1
echo "== $(date '+%F %T')"

alert() { # 題名 本文 質問
  if gh issue list -R ryusei2790/mywork -S "$1 in:title" --state open --json number -q '.[0].number' | grep -q .; then
    echo "既に Issue あり: $1"; return
  fi
  local n; n=$("$WAIT" new "$1" "${2}（mywork#764 ④ の見張り。ログ: ~/Library/Logs/kakebo-monitor.log）" dept:dev type:task) || return
  "$WAIT" me "$n" "$3"
  echo "Issue #$n: $1"
}

# 1. 本番の health（Mac が起きた直後は回線が無いことがあるので3回まで）
for i in 1 2 3; do
  BODY=$(curl -s -m 30 -w ' %{http_code}' "$URL/api/health") && break; sleep 20
done
CODE=${BODY##* }
echo "health: ${CODE} ${BODY:0:80}"
case "$CODE" in
  200) ;;
  503)
    if echo "$BODY" | grep -q '"db":false'; then
      alert "家計簿の本番 DB に届きません" "$URL/api/health が db:false（Supabase が休止・停止している可能性）" \
        "Supabase のダッシュボードで kakebo のプロジェクトが Paused なら Restore を押してください。A 押した / B 止まっていなかった（AI が原因を調べる）"
    else
      alert "家計簿の定期の自動作成が止まっています" "$URL/api/health が cron:false（毎日 0:05 の定期の展開が今日の分まで済んでいない）" \
        "AI が Vercel のログと CRON_SECRET を調べて直します。A 調べて直して（推し）/ B 様子を見る"
    fi ;;
  000|"") echo "health に届かない。Mac の回線の可能性があるので Issue は立てない" ;;
  *)
    alert "家計簿の本番が応答しません" "$URL/api/health が HTTP ${CODE}" \
      "AI が Vercel の状態とログを調べます。A 調べて（推し）/ B 自分で見る" ;;
esac

# 2. Vercel の失敗デプロイ
ST=$(gh api repos/ryusei2790/app/commits/main/status -q '[.statuses[]|select(.context=="Vercel")][0].state' 2>/dev/null)
echo "vercel: ${ST:-不明}"
if [ "$ST" = "failure" ] || [ "$ST" = "error" ]; then
  SHA=$(gh api repos/ryusei2790/app/commits/main -q .sha | cut -c1-7)
  alert "家計簿の本番デプロイが失敗しています" "app の main（${SHA}）の Vercel デプロイが ${ST}。本番は1つ前の版のまま動いています" \
    "AI がビルドのログを見て直す PR を出します。A 直して（推し）/ B 自分で見る"
fi

# 3. 定期バックアップの直近の実行
if [ -f "$BLOG" ]; then
  LAST=$(awk '/^== /{b=""} {b=b $0 "\n"} END{printf "%s", b}' "$BLOG")
  if [ -n "$LAST" ] && ! echo "$LAST" | grep -q '"ok":true'; then
    echo "backup: 直近の実行が失敗"
    alert "家計簿の定期バックアップが失敗しました" "直近の実行（$(echo "$LAST" | head -1 | cut -c4-)）に ok:true がありません" \
      "AI がログを見て直します。A 直して（推し）/ B 手で流す: bash ~/.local/share/kakebo-backup/scripts/backup/run.sh"
  fi
fi
exit 0
