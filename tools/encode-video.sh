#!/bin/sh
# 動画をサイト掲載用に変換する（ヒーロー・過去リール共通）
#   使い方: sh tools/encode-video.sh <元動画.mov/.mp4> <出力名.mp4> [開始秒] [秒数]
#   例:     sh tools/encode-video.sh ~/Downloads/IMG_1234.MOV hero.mp4 3 15
#
# 現行 hero.mp4 の仕様に合わせる（2026-10-14 実測：縦720px・h264・aac・約15秒・1.7MB）
# - 音声は残す（音声ボタンで鳴らすため。自動再生は無音で始まる）
# - 高さ720px・幅は比率維持（偶数）／30fps に落として容量を抑える
# - 20秒を上限にする（Pagesの容量・帯域。リポジトリに入るのは変換後だけ）
# - iPhoneのメタデータ等の data ストリームを捨てる／faststart で再生開始を早める
set -eu
SRC=${1:?元動画のパス}
OUT=${2:?出力ファイル名}
SS=${3:-0}
DUR=${4:-15}
[ "$DUR" -gt 20 ] && { echo "20秒を超える長さは載せない（指定: ${DUR}秒）" >&2; exit 1; }
ffmpeg -hide_banner -loglevel error -y -ss "$SS" -i "$SRC" -t "$DUR" \
  -map 0:v:0 -map '0:a:0?' -dn \
  -vf "scale=-2:720,fps=30" -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -map_metadata -1 -write_tmcd 0 -movflags +faststart "$OUT"
SIZE=$(wc -c < "$OUT")
echo "出力: $OUT ($(( SIZE / 1024 )) KB)"
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact "$OUT"
[ "$SIZE" -gt 5242880 ] && echo "⚠️ 5MBを超えた。秒数を短くするか CRF を上げる" >&2
exit 0
