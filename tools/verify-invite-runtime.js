#!/usr/bin/env node
/* 検証: /invite/?n=<名前> の実行時プロモーター固定。
   実行: NODE_PATH=~/.cache/claude-node/node_modules node tools/verify-invite-runtime.js

   /invite/ は既に外部へ公開されている（誰でも開ける）。既存の挙動を壊さないことが最優先。
   守りたい不変条件:
   - 無料招待であり続ける（type=free のまま。有料に化けない）
   - VIP導線は出さない（招待版の仕様）
   - ?n= を付けたときだけ promoter が付く。付けなければ従来と完全に同一
   - /invite/<slug>/（配布済みの3名）は静的のまま。?n= で上書きできない
   - 公開トップにスニペットが混入していない */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const A = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function open(file, search) {
  return new JSDOM(read(file), {
    runScripts: 'dangerously',
    url: 'https://luxepartycom.github.io/luxe-site/' + path.dirname(file) + '/' + search
  });
}
const entryLinks = doc => [...doc.querySelectorAll('a[href^="https://entry.luxepartytokyo.com/"]')].map(a => a.getAttribute('href'));

const NAME = '山田太郎';
const ENC = encodeURIComponent(NAME);

console.log('\n── /invite/?n=<名前> ────────────────────────');
{
  const dom = open('invite/index.html', '?n=' + ENC);
  const es = entryLinks(dom.window.document);
  const applyLinks = es.filter(h => h.includes('index.html?e='));
  A('申込リンクがある', applyLinks.length > 0);
  A('無料のまま(type=free)', applyLinks.every(h => h.includes('type=free')));
  A('有料(type=paid)に化けていない', !es.some(h => h.includes('type=paid')));
  A('promoter が付く', applyLinks.every(h => h.includes('promoter=' + ENC)));
  A('promoter が二重に付かない', applyLinks.every(h => (h.match(/promoter=/g) || []).length === 1));
  A('VIP導線は出さない', !es.some(h => h.includes('vip-plan.html')));
  console.log('     例: ' + decodeURIComponent(applyLinks[0] || ''));
  dom.window.close();
}

console.log('\n── /invite/（従来どおり・名前なし）───────────');
{
  const dom = open('invite/index.html', '');
  const es = entryLinks(dom.window.document);
  A('申込リンクがある（壊れない）', es.length > 0);
  A('無料のまま(type=free)', es.filter(h => h.includes('index.html?e=')).every(h => h.includes('type=free')));
  A('promoter は付かない（従来と同一）', es.every(h => !h.includes('promoter=')));
  A('VIP導線なし', !es.some(h => h.includes('vip-plan.html')));
  dom.window.close();
}

console.log('\n── 記号入りの名前 ──────────────────────────');
{
  const N2 = 'A&B 太郎';
  const dom = open('invite/index.html', '?n=' + encodeURIComponent(N2));
  const es = entryLinks(dom.window.document).filter(h => h.includes('index.html?e='));
  A('URLが壊れない', es.every(h => h.includes('promoter=' + encodeURIComponent(N2))));
  const u = new URL(es[0]);
  A('URL解析で元の名前に戻る', u.searchParams.get('promoter') === N2);
  A('type=free も維持される', u.searchParams.get('type') === 'free');
  dom.window.close();
}

console.log('\n── /invite/<slug>/（配布済み3名）は静的のまま ──');
for (const slug of ['daiko', 'ren', 'ryu']) {
  const html = read(`invite/${slug}/index.html`);
  A(`[${slug}] 実行時スニペットを入れていない`, !html.includes('luxe_promoter'));
  const es = (html.match(/https:\/\/entry\.luxepartytokyo\.com[^"']*/g) || []).map(h => h.replace(/&amp;/g, '&'));
  const applyLinks = es.filter(h => h.includes('index.html?e='));
  A(`[${slug}] 無料＋本人固定のまま`, applyLinks.length > 0 && applyLinks.every(h => h.includes('type=free') && h.includes('promoter=')));
}

console.log('\n── 公開トップへの混入がないこと ────────────────');
{
  A('index.html にスニペットなし',    !read('index.html').includes('luxe_promoter'));
  A('p/ryu/ にスニペットなし',        !read('p/ryu/index.html').includes('luxe_promoter'));
  A('p/index.html には入っている',     read('p/index.html').includes('luxe_promoter'));
  A('invite/index.html に入っている',  read('invite/index.html').includes('luxe_promoter'));
}

console.log('\n── 英語版 ───────────────────────────────────');
{
  const dom = open('en/invite/index.html', '?n=' + ENC);
  const es = entryLinks(dom.window.document).filter(h => h.includes('index.html?e='));
  A('en/invite/ も promoter が付く', es.length > 0 && es.every(h => h.includes('promoter=')));
  A('en/invite/ も無料のまま', es.every(h => h.includes('type=free')));
  dom.window.close();
}

console.log('\n' + (fail === 0 ? `—— 全合格 ✅（${pass}件）——` : `—— 不合格 ${fail}件 / 合格 ${pass}件 ❌ ——`));
process.exit(fail === 0 ? 0 : 1);
