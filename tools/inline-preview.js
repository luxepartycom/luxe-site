#!/usr/bin/env node
/* 生成済みページを1枚の自己完結HTMLに変換する（CSS埋め込み・画像をデータURI化）。
   ブラウザ/Artifact での見た目確認用。まず `node tools/build-local.js` を実行しておくこと。
   外部フォントは CSP 環境では読めずフォールバック表示になる（実サイトでは専用フォント）。

   使い方:
     node tools/inline-preview.js [ページ相対パス] [出力パス]
   例:
     node tools/inline-preview.js index.html preview-top.html
     node tools/inline-preview.js archive/index.html preview-archive.html

   --body-only を付けると <style>+<body>内容 のみ出力（Artifact 用に <head>/<body> を除く）。 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter(a => a !== '--body-only');
const bodyOnly = process.argv.includes('--body-only');
const ROOT = path.join(__dirname, '..');
const pageRel = args[0] || 'index.html';
const outPath = args[1] || path.join(ROOT, 'preview.html');

let html = fs.readFileSync(path.join(ROOT, pageRel), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'assets/site.css'), 'utf8');

// CSS を <style> に埋め込む
html = html.replace(/<link rel="stylesheet" href="[^"]*assets\/site\.css">/,
  '<style>\n' + css + '\n</style>');

// 画像（assets/...）をデータURIに変換
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
html = html.replace(/((?:src|href)=")((?:\.\.\/)*assets\/[^"]+)"/g, (m, pre, rel) => {
  const clean = rel.replace(/^(\.\.\/)+/, '');            // base の ../ を剥がす
  const abs = path.join(ROOT, clean);
  if (!fs.existsSync(abs)) return m;
  const ext = path.extname(abs).toLowerCase();
  if (!mime[ext]) return m;
  const b64 = fs.readFileSync(abs).toString('base64');
  return pre + `data:${mime[ext]};base64,${b64}"`;
});

let out = html;
if (bodyOnly) {
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  const body = (html.match(/<body>([\s\S]*?)<\/body>/) || ['', ''])[1];
  out = style + '\n' + body;
}

fs.writeFileSync(outPath, out);
console.log('wrote', outPath, Math.round(out.length / 1024) + 'KB', bodyOnly ? '(body-only)' : '');
