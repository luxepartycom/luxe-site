#!/usr/bin/env node
/* 検証: 開催終了後のCTA自動切替。
   実行: NODE_PATH=~/.cache/claude-node/node_modules node tools/verify-ended-runtime.js

   守りたい不変条件:
   - 開催前／開催中は購入導線がそのまま（勝手に消さない）
   - 終了時刻を過ぎたら、購入CTAが次回集客（LINE / Instagram）へ差し替わる
   - 終了した旨を明示する（黙って差し替えない）
   - 申込システムへのリンクが残らない（終了後に買えてしまわない）
   - トップ・イベント個別・/p/・/invite/ すべてに効く
   - アーカイブ一覧には入れない（イベントページではないため） */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const A = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ページに埋め込まれた終了時刻を読み、その前後の時刻で開いて挙動を比べる
function endMsOf(html) {
  const m = html.match(/var END = (\d+);/);
  return m ? Number(m[1]) : 0;
}
function open(html, nowMs) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://luxepartycom.github.io/luxe-site/' });
  const w = dom.window;
  // Date.now() を固定してからページのスクリプトを実行する
  w.eval('Date.now = function(){ return ' + nowMs + '; };');
  const scripts = [...dom.window.document.querySelectorAll('script:not([src])')].map(s => s.textContent);
  scripts.forEach(src => { try { w.eval(src); } catch (e) {} });
  return dom;
}
const entryLinks = doc => [...doc.querySelectorAll('a[href^="https://entry.luxepartytokyo.com/"]')].map(a => a.getAttribute('href'));

const PAGES = [
  ['index.html', 'トップ'],
  ['events/2026-08-09-luxe-pool-party/index.html', 'イベント個別'],
  ['p/index.html', 'プロモーター(実行時)'],
  ['p/ryu/index.html', 'プロモーター(個別)'],
  ['invite/index.html', '無料招待']
];

for (const [file, label] of PAGES) {
  console.log('\n── ' + label + '（' + file + '）──────────────');
  const html = read(file);
  const END = endMsOf(html);
  A('終了時刻が埋め込まれている', END > 0);
  if (!END) continue;

  // ① 開催前（終了1時間前）
  {
    const d = open(html, END - 3600 * 1000).window.document;
    const links = entryLinks(d);
    A('開催中は申込リンクが残る', links.length > 0);
    A('開催中は終了表示を出さない', !d.getElementById('ended-notice'));
    A('開催中はLINEに差し替えない', !!d.querySelector('.hero-cta .btn-fill') &&
      !/lin\.ee/.test(d.querySelector('.hero-cta .btn-fill').getAttribute('href') || ''));
  }

  // ② 終了後（終了1分後）
  {
    const dom = open(html, END + 60 * 1000);
    const d = dom.window.document;
    A('終了マークが付く', d.documentElement.getAttribute('data-event-ended') === '1');
    A('終了した旨を明示する', !!d.getElementById('ended-notice'));
    A('文言が入っている', /終了しました|has ended/.test((d.getElementById('ended-notice') || {}).textContent || ''));
    const hero = d.querySelector('.hero-cta .btn-fill');
    A('主CTAがLINEへ差し替わる', !!hero && /lin\.ee/.test(hero.getAttribute('href') || ''));
    A('主CTAの文言が次回案内', /次回|updates/i.test((hero || {}).textContent || ''));
    const sf = d.querySelector('.sticky-cta .scta-fill');
    const sl = d.querySelector('.sticky-cta .scta-line');
    if (sf) A('常時バーの主ボタンもLINE', /lin\.ee/.test(sf.getAttribute('href') || ''));
    if (sl) A('常時バーの副ボタンはInstagram', /instagram/.test(sl.getAttribute('href') || ''));
    A('申込システムへのリンクが残らない', entryLinks(d).length === 0);
    dom.window.close();
  }
}

console.log('\n── アーカイブ一覧には入れない ──────────────');
A('archive にスニペットなし', !read('archive/index.html').includes('data-event-ended'));
A('en/archive にもなし',      !read('en/archive/index.html').includes('data-event-ended'));

console.log('\n── 英語版 ───────────────────────────────');
{
  const html = read('en/index.html');
  const END = endMsOf(html);
  A('en にも埋め込まれている', END > 0);
  if (END) {
    const d = open(html, END + 60 * 1000).window.document;
    A('en も終了表示が出る', !!d.getElementById('ended-notice'));
    A('en は英語の文言', /has ended/.test((d.getElementById('ended-notice') || {}).textContent || ''));
  }
}

console.log('\n' + (fail === 0 ? `—— 全合格 ✅（${pass}件）——` : `—— 不合格 ${fail}件 / 合格 ${pass}件 ❌ ——`));
process.exit(fail === 0 ? 0 : 1);
