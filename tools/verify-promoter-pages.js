#!/usr/bin/env node
/* 検証: プロモーター専用サイト /p/<slug>/ が正しく生成されているか。
   ビルド後に実行する:  node tools/build-local.js && node tools/verify-promoter-pages.js

   守りたい不変条件:
   - /p/ は「通常サイト（有料チケット＋VIP）でプロモーターだけ固定」
   - /invite/ は従来どおり「無料招待・VIP導線なし」
   - 公開サイト（トップ）は一切変わらない（VIPはLINEのまま・indexされる）
   - VIP申込URLのイベントIDは予約システム側のID(EV-…)であること
     （サイト内部スラッグを入れると申込が成立しない。実際に一度やらかした） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const A = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };
const read = p => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/&amp;/g, '&'); } catch (e) { return ''; } };
const hrefs = html => (html.match(/https:\/\/entry\.luxepartytokyo\.com[^"']*/g) || []);

const PROMOTERS = ['daiko', 'ren', 'ryu'];

console.log('\n── 公開サイト（変えてはいけない）─────────────────');
{
  const top = read('index.html');
  A('トップが生成されている', top.length > 0);
  A('トップは noindex ではない', !/noindex/.test(top));
  A('トップのVIPボタンはLINEのまま', /scta-line[^>]*href="https:\/\/lin\.ee\//.test(top));
  A('トップに promoter は付かない', !hrefs(top).some(h => h.includes('promoter=')));
  A('トップのチケットは有料(type=paid)', hrefs(top).some(h => h.includes('type=paid')));
}

console.log('\n── /p/<slug>/ プロモーター専用サイト ───────────────');
for (const slug of PROMOTERS) {
  const html = read(`p/${slug}/index.html`);
  const hs = hrefs(html);
  console.log(`  [${slug}]`);
  A('  ページが生成されている', html.length > 0);
  A('  noindex が付く', /noindex/.test(html));
  A('  申込リンクが全て promoter 固定', hs.length > 0 && hs.every(h => h.includes('promoter=')));
  A('  チケットは有料のまま(type=paid)', hs.some(h => h.includes('type=paid') && h.includes('promoter=')));
  A('  無料URL(type=free)になっていない', !hs.some(h => h.includes('type=free')));
  const vip = hs.filter(h => h.includes('vip-plan.html'));
  A('  VIP申込リンクがある（LINEではない）', vip.length > 0);
  A('  VIPにも promoter が付く', vip.every(h => h.includes('promoter=')));
  A('  VIPのイベントIDが予約システム側(EV-…)', vip.every(h => /[?&]e=EV-[A-Z0-9]+/.test(h)));
  A('  VIPにサイト内部スラッグが混入していない', !vip.some(h => /[?&]e=\d{4}-\d{2}-\d{2}-/.test(h)));
}

console.log('\n── /invite/<slug>/ 無料招待版（従来どおり）──────────');
for (const slug of PROMOTERS) {
  const html = read(`invite/${slug}/index.html`);
  const hs = hrefs(html);
  A(`[${slug}] 無料URL(type=free)のまま`, hs.length > 0 && hs.every(h => h.includes('type=free')));
  A(`[${slug}] VIP申込導線は出さない`, !hs.some(h => h.includes('vip-plan.html')));
  A(`[${slug}] promoter は固定`, hs.every(h => h.includes('promoter=')));
}

console.log('\n── 検索エンジンへの露出 ──────────────────────────');
{
  const robots = read('robots.txt');
  const sitemap = read('sitemap.xml');
  A('robots が /p/ を拒否', /Disallow: \/p\//.test(robots));
  A('robots が /en/p/ を拒否', /Disallow: \/en\/p\//.test(robots));
  A('robots が /invite/ を拒否（従来）', /Disallow: \/invite\//.test(robots));
  A('sitemap に /p/ を載せない', !/\/p\//.test(sitemap));
}

console.log('\n── 英語版 ───────────────────────────────────');
{
  const en = read('en/p/ryu/index.html');
  A('en/p/ryu/ が生成されている', en.length > 0);
  A('en 版も promoter 固定', hrefs(en).length > 0 && hrefs(en).every(h => h.includes('promoter=')));
}

console.log('\n' + (fail === 0 ? `—— 全合格 ✅（${pass}件）——` : `—— 不合格 ${fail}件 / 合格 ${pass}件 ❌ ——`));
process.exit(fail === 0 ? 0 : 1);
