#!/usr/bin/env node
/* 動画ファーストのヒーロー（最初は動画だけ→少しスクロールで文字がせり上がる）の検査。2026-10-14
   実際に生成したトップページを jsdom で開き、操作を送って html の class を見る。 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = process.env.LUXE_CHECK_DIR || path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../assets/site.css'), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }
function open(opts) {
  opts = opts || {};
  const vc = new VirtualConsole();   // ほかのスクリプトの jsdom 由来のエラーは無視する
  const dom = new JSDOM(opts.html || HTML, {
    runScripts: 'dangerously', url: 'https://luxepartytokyo.com/' + (opts.hash || ''), virtualConsole: vc,
    beforeParse(w) {
      if (opts.noMatchMedia) return;
      w.matchMedia = q => ({ matches: !!opts.reduce && /reduce/.test(q), addListener() {}, removeListener() {} });
    }
  });
  const w = dom.window, cl = w.document.documentElement.classList;
  return { w, gate: () => cl.contains('hero-gate'), shown: () => !cl.contains('hero-gate') || cl.contains('hero-revealed') };
}

let p = open();
ok(p.gate() && !p.shown(), '開いた直後は動画だけ（hero-gate・文字は隠れている）');
ok(p.w.document.querySelector('.scroll-cue'), 'SCROLL の案内がある');
p.w.dispatchEvent(new p.w.WheelEvent('wheel', { deltaY: -20 }));
ok(!p.shown(), '上向きのホイールでは出さない');
p.w.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'a' }));
ok(!p.shown(), '関係ないキーでは出さない');
p.w.dispatchEvent(new p.w.WheelEvent('wheel', { deltaY: 8 }));
ok(p.shown(), '下向きのホイール1回で文字がせり上がる');

p = open(); p.w.dispatchEvent(new p.w.Event('touchmove')); ok(p.shown(), '指でなぞると出る');
p = open(); p.w.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowDown' })); ok(p.shown(), '↓キーで出る');
p = open(); Object.defineProperty(p.w, 'scrollY', { get: () => 40, configurable: true }); p.w.dispatchEvent(new p.w.Event('scroll')); ok(p.shown(), '下へスクロールすると出る（位置40）');
p = open(); p.w.document.querySelector('.scroll-cue').click(); ok(p.shown(), 'SCROLL の案内を押すと出る');

// 一番上まで戻したら、また動画だけに戻す
{
  const q = open(); let y = 0;
  Object.defineProperty(q.w, 'scrollY', { get: () => y, configurable: true });
  y = 300; q.w.dispatchEvent(new q.w.Event('scroll')); ok(q.shown(), '下へスクロールすると出る');
  y = 120; q.w.dispatchEvent(new q.w.Event('scroll')); ok(q.shown(), '途中まで戻しても出たまま');
  y = 0;   q.w.dispatchEvent(new q.w.Event('scroll')); ok(!q.shown(), '一番上まで戻すと消える');
  q.w.dispatchEvent(new q.w.WheelEvent('wheel', { deltaY: 6 })); ok(q.shown(), '一番上から再び下へで、また出る');
  q.w.dispatchEvent(new q.w.WheelEvent('wheel', { deltaY: -6 })); ok(!q.shown(), '一番上で上向きのホイールなら消える');
  y = 200; q.w.dispatchEvent(new q.w.Event('scroll'));
  q.w.dispatchEvent(new q.w.WheelEvent('wheel', { deltaY: -6 })); ok(q.shown(), '途中での上向きホイールでは消さない');
}

// キーボードで隠れたボタンにフォーカスが入ったら見せる
{
  const q = open(); const btn = q.w.document.querySelector('.hero-cta a');
  ok(btn, 'ヒーローにボタンがある');
  btn.focus(); ok(q.shown(), 'ヒーローのボタンにフォーカスが入ると見せる');
  ok(q.w.document.documentElement.classList.contains('hero-instant'), 'フォーカスで見せるときは動きなしで即座に');
  const q2 = open(); const sb = q2.w.document.querySelector('.sticky-cta a');
  if (sb) { sb.focus(); ok(q2.shown(), '固定バーのボタンにフォーカスが入ると見せる'); }
  const q3 = open(); q3.w.document.querySelector('.scroll-cue').focus(); ok(!q3.shown(), 'SCROLL 案内へのフォーカスだけでは出さない');
}
// 途中で失敗したら全部見せる（リスナー登録が例外を投げる環境）
{
  const vc = new VirtualConsole();
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', url: 'https://luxepartytokyo.com/', virtualConsole: vc,
    beforeParse(w) { w.matchMedia = () => ({ matches: false }); const orig = w.addEventListener.bind(w); w.addEventListener = (n, f, o) => { if (n === 'wheel') throw new Error('boom'); return orig(n, f, o); }; } });
  const cl = dom.window.document.documentElement.classList;
  ok(!cl.contains('hero-gate'), '途中で例外が起きたら隠さない（フェイルオープン）');
}
// 終了したイベントのページでは告知を隠さない
{
  const ended = fs.readdirSync(path.join(ROOT, 'events')).map(id => path.join(ROOT, 'events', id, 'index.html'))
    .find(f => /var END = \d+/.test(fs.readFileSync(f, 'utf8')) && +fs.readFileSync(f, 'utf8').match(/var END = (\d+)/)[1] < Date.now() && /<video class="hero-vid"/.test(fs.readFileSync(f, 'utf8')));
  ok(ended, '動画のある終了済みイベントのページがある');
  if (ended) {
    const q = open({ html: fs.readFileSync(ended, 'utf8') });
    ok(q.w.document.documentElement.getAttribute('data-event-ended') === '1', '終了済みと判定される');
    ok(q.shown(), '終了済みのページは最初から全部見せる（終了告知を隠さない）');
    // 末尾の終了判定より前（ヒーロー直後）の時点で、すでに隠していないこと
    const early = open({ html: fs.readFileSync(ended, 'utf8').replace(/<script>\s*\(function\(\)\{\s*\/\/ 開催終了時刻[\s\S]*?<\/script>/, '') });
    ok(early.shown(), '終了済みなら末尾の判定を待たずに最初から隠さない');
  }
}

// 見落としを防ぐ安全策：最初から全部見せる
ok(open({ reduce: true }).shown(), '動きを減らす設定なら最初から全部見せる');
ok(open({ noMatchMedia: true }).shown(), 'スクリプトが失敗したら最初から全部見せる');
ok(open({ hash: '#access' }).shown(), '途中の位置（#付き）から開いたら最初から全部見せる');
ok(open({ html: HTML.replace(/<video class="hero-vid"/, '<img class="no-video"') }).shown(), '動画が無いページでは隠さない');

// CSS：ゲート中は文字・固定バーを隠し、解除で戻す。動きを減らす設定では常に表示
ok(/html\.hero-gate \.hero-inner > \*\{animation-name:none; opacity:0/.test(CSS), 'ゲート中は文字を隠す CSS');
ok(/html\.hero-gate\.hero-revealed \.hero-inner > \*\{opacity:1; transform:none/.test(CSS), '解除で文字をせり上げる CSS');
ok(/html\.hero-gate:not\(\.hero-revealed\) \.sticky-cta\{transform:translateY\(110%\)\}/.test(CSS), 'ゲート中は固定バーを隠す CSS');
ok(/html\.hero-instant \.hero-inner > \*, html\.hero-instant \.sticky-cta\{transition:none !important\}/.test(CSS), 'フォーカス時は動きを止める CSS');

console.log(fail ? `—— 失敗 ${fail}件 / 合格 ${pass}件 ——` : `—— 全合格 ✅（${pass}件）——`);
process.exit(fail ? 1 : 0);
