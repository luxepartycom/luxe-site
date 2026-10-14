#!/bin/sh
# LUXE-SITE の検査を全部走らせる。1本でも落ちたら exit 1。
#   使い方: sh tools/test-all.sh
# 先にサイトを生成し直す（検査の多くは生成済みHTMLを読むため）
cd "$(dirname "$0")/.." || exit 1
export NODE_PATH="${NODE_PATH:-$HOME/.cache/claude-node/node_modules}"   # jsdom の置き場所
node tools/build-local.js > /dev/null || { echo "✗ build-local"; exit 1; }
failed=0
for t in verify-links verify-ended-runtime verify-invite-runtime verify-promoter-pages verify-promoter-runtime verify-line-mode; do
  if node "tools/$t.js" > "${TMPDIR:-/tmp}/luxe-$t.log" 2>&1; then
    echo "✓ $t  $(tail -1 "${TMPDIR:-/tmp}/luxe-$t.log")"
  else
    echo "✗ $t"; tail -15 "${TMPDIR:-/tmp}/luxe-$t.log"; failed=1
  fi
done
exit $failed
