#!/bin/sh
# LUXE-SITE の検査を全部走らせる。1本でも落ちたら exit 1。
#   使い方: sh tools/test-all.sh
# 1) 実データで生成し直し、リンクと LINE モードを検査する
# 2) チケット販売型の検査用データ（LINE モードのイベントを除いたもの）を一時ディレクトリに生成し、
#    招待・プロモーター・終了後の差し替えを検査する（チケット型に戻すときの保証を残す）
cd "$(dirname "$0")/.." || exit 1
export NODE_PATH="${NODE_PATH:-$HOME/.cache/claude-node/node_modules}"   # jsdom の置き場所
LOG="${TMPDIR:-/tmp}"
node tools/build-local.js > /dev/null || { echo "✗ build-local"; exit 1; }
TK=$(mktemp -d "$LOG/luxe-ticket.XXXXXX") || exit 1
node -e '
const d = JSON.parse(require("fs").readFileSync("sample/sheet-sample.json", "utf8"));
d.events = d.events.filter(e => String(e.ctaMode || "").toLowerCase() !== "line");
require("fs").writeFileSync(process.argv[1], JSON.stringify(d));' "$TK/in.json" || exit 1
mkdir -p "$TK/out" && LUXE_OUT="$TK/out" node tools/build-local.js "$TK/in.json" > /dev/null || { echo "✗ build-local (ticket)"; exit 1; }
# 生成しない静的ファイル（CSS・画像・法務ページ・favicon）も揃えて、リンク検査を本物と同じ条件にする
cp -R assets favicon.svg favicon-32.png apple-touch-icon.png icon-512.png attention.html privacy.html tokusho.html "$TK/out/" || exit 1
failed=0
run() {   # run <表示名> <検査ファイル> [検査する出力]
  if LUXE_CHECK_DIR="$3" node "tools/$2.js" > "$LOG/luxe-$1.log" 2>&1; then
    echo "✓ $1  $(tail -1 "$LOG/luxe-$1.log")"
  else
    echo "✗ $1"; tail -15 "$LOG/luxe-$1.log"; failed=1
  fi
}
run links             verify-links
run line-mode         verify-line-mode
run hero-gate         verify-hero-gate
run links@ticket      verify-links            "$TK/out"
run ended@ticket      verify-ended-runtime    "$TK/out"
run invite@ticket     verify-invite-runtime   "$TK/out"
run promoter@ticket   verify-promoter-pages   "$TK/out"
run promoter-rt@ticket verify-promoter-runtime "$TK/out"
exit $failed
