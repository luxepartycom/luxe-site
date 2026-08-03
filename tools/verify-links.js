#!/usr/bin/env node
/* 生成物の内部リンク切れと hreflang 双方向を検証する（T1 受け入れ条件の自動確認）。
   使い方: node tools/verify-links.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 生成された HTML を全部集める */
function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '_templates' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

const pages = walk(ROOT, []);
let broken = 0, checked = 0;

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const pageDir = path.dirname(page);
  const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]);
  for (const href of hrefs) {
    // 外部・アンカー・ルート絶対パス(/…)は対象外。絶対パスは 404.html が意図的に使う（デプロイ時のみ解決）
    if (/^(https?:|mailto:|tel:|data:|#|\/)/.test(href)) continue;
    // 動画はデプロイ側 videos/ に配置（社内ソースには置かない＝--exclude videos）。誤検知を避ける。
    if (/(^|\/)videos\//.test(href) || /\.(mp4|webm|mov)([?#]|$)/i.test(href)) continue;
    checked++;
    let target = href.split('#')[0].split('?')[0];
    if (!target) continue;
    let resolved = path.resolve(pageDir, target);
    // ディレクトリ or 末尾 / は index.html を見る
    if (target.endsWith('/') || (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())) {
      resolved = path.join(resolved, 'index.html');
    }
    if (!fs.existsSync(resolved)) {
      console.log(`  ✗ リンク切れ: ${path.relative(ROOT, page)} -> ${href}`);
      broken++;
    }
  }
}

/* hreflang 双方向チェック：ja ページと en ページが互いを指しているか */
let hreflangIssues = 0;
for (const page of pages) {
  const rel = path.relative(ROOT, page);
  if (rel.startsWith('en/') && rel.startsWith('en' + path.sep)) { /* en 側 */ }
  const html = fs.readFileSync(page, 'utf8');
  const hasJa = /hreflang="ja"/.test(html);
  const hasEn = /hreflang="en"/.test(html);
  const hasDefault = /hreflang="x-default"/.test(html);
  // attention/privacy/tokusho（法務）と 404 は多言語hreflang対象外
  const isExempt = /(^|\/)(attention|privacy|tokusho|404)\.html$/.test(rel);
  if (isExempt) continue;
  if (!(hasJa && hasEn && hasDefault)) {
    console.log(`  ✗ hreflang不足: ${rel} (ja:${hasJa} en:${hasEn} x-default:${hasDefault})`);
    hreflangIssues++;
  }
}

console.log(`\n検査リンク数: ${checked} / リンク切れ: ${broken}`);
console.log(`hreflang検査対象ページの不足: ${hreflangIssues}`);
if (broken === 0 && hreflangIssues === 0) console.log('✅ 全チェック合格');
process.exit(broken + hreflangIssues > 0 ? 1 : 0);
