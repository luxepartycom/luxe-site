#!/usr/bin/env node
/* かくつき対策の検査（2026-10-14）。動画は画面に入っている間だけ再生／重い効果を外したこと。 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = process.env.LUXE_CHECK_DIR || path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(__dirname, '../assets/site.css'), 'utf8');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }

function open(file, withIO) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const obs = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://luxepartytokyo.com/', virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false });
      w.HTMLMediaElement.prototype.play = function () { this._played = (this._played || 0) + 1; Object.defineProperty(this, 'paused', { value: false, configurable: true }); return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () { this._paused = (this._paused || 0) + 1; Object.defineProperty(this, 'paused', { value: true, configurable: true }); };
      if (withIO) w.IntersectionObserver = function (cb) { const o = { cb, els: [], observe(el) { o.els.push(el); }, unobserve() {}, disconnect() {} }; obs.push(o); return o; };
      else delete w.IntersectionObserver;
    } });
  return { w: dom.window, html, obs };
}

for (const file of ['index.html', 'archive/index.html']) {
  const { w, html, obs } = open(file, true);
  const vids = Array.from(w.document.querySelectorAll('video'));
  const lazy = vids.filter(v => v.hasAttribute('data-autoplay'));
  ok(vids.length > 0, file + ' に動画がある');
  ok(vids.filter(v => !v.classList.contains('hero-vid')).every(v => !v.hasAttribute('autoplay') && v.hasAttribute('data-autoplay') && v.getAttribute('preload') === 'none'),
    file + ' ヒーロー以外の動画は自動再生せず preload="none"');
  const io = obs.find(o => o.els.some(e => e.hasAttribute && e.hasAttribute('data-autoplay')));   // 音声ボタン用の見張り（ヒーローのみ）と区別する
  ok(io && io.els.length === vids.length, file + ' 全動画を画面内判定に登録');
  if (io && lazy[0]) {
    const v = lazy[0];
    io.cb([{ target: v, isIntersecting: true }]);
    ok(v._played >= 1 && v.preload === 'metadata', file + ' 画面に入ったら読み込んで再生');
    io.cb([{ target: v, isIntersecting: false }]);
    ok(v._paused >= 1, file + ' 画面から出たら一時停止');
  }
  if (file === 'index.html') {
    const hero = w.document.querySelector('video.hero-vid');
    ok(hero && hero.hasAttribute('autoplay'), 'ヒーローは従来どおり自動再生');
    if (io && hero) { io.cb([{ target: hero, isIntersecting: true }]); io.cb([{ target: hero, isIntersecting: false }]); ok(hero._paused >= 1, 'ヒーローも画面外では止める'); }
  }
}
// 音声を出していた動画が画面外に出たら、音声も切る
{
  const { w, obs } = open('index.html', true);
  const io = obs.find(o => o.els.some(e => e.hasAttribute && e.hasAttribute('data-autoplay')));
  const v = w.document.querySelector('video[data-autoplay]');
  if (io && v && w.__luxeAudio) {
    w.__luxeAudio.set(v);
    ok(w.__luxeAudio.current() === v && v.muted === false, '（前提）過去動画の音声をオン');
    io.cb([{ target: v, isIntersecting: false }]);
    ok(w.__luxeAudio.current() === null && v.muted === true, '画面外に出たら音声も切る');
  } else ok(false, '音声の検査の前提がそろわない');
}
// 読み込み前の表紙（poster）と、古い Safari 向けの光の帯の停止
{
  const { w } = open('index.html', true);
  ok(Array.from(w.document.querySelectorAll('video[data-autoplay]')).every(v => v.getAttribute('poster')), '過去動画にはイベント写真の表紙がある');
  ok(w.document.querySelector('.hero-media.has-video'), '動画のヒーローに has-video が付く');
}
ok(/\.hero-media\.has-video ~ \.beam\{display:none\}/.test(CSS), ':has() 非対応でも光の帯を止める');

// IntersectionObserver が無い環境では全部再生する（真っ黒のままにしない）
{
  const { w } = open('index.html', false);
  ok(Array.from(w.document.querySelectorAll('video[data-autoplay]')).every(v => v._played >= 1), 'IntersectionObserver が無ければ全部再生');
}
// 重い効果を外した CSS
ok(/\.sticky-cta\{background:rgba\(8,7,12,\.94\); -webkit-backdrop-filter:none; backdrop-filter:none\}/.test(CSS), '固定バーのすりガラスを外した');
ok(/header\.scrolled\{background:rgba\(8,7,12,\.9\); -webkit-backdrop-filter:none; backdrop-filter:none\}/.test(CSS), 'ヘッダーのすりガラスを外した');
ok(/body::before\{mix-blend-mode:normal; opacity:\.035\}/.test(CSS), '粒子の色合成をやめた');
ok(/\.hero:has\(video\.hero-vid\) \.beam\{display:none\}/.test(CSS), '動画のあるヒーローでは光の帯を出さない');

// シェア用画像（og:image）の URL に ../ を残さない（個別ページは base が ../../）
for (const f of ['index.html'].concat(fs.readdirSync(path.join(ROOT, 'events')).map(id => 'events/' + id + '/index.html'))) {
  const m = fs.readFileSync(path.join(ROOT, f), 'utf8').match(/property="og:image" content="([^"]*)"/);
  ok(!m || !/\/\.\.?\//.test(m[1].replace(/^https?:\/\//, '')), f + ' の og:image に ../ が無い');
}

console.log(fail ? `—— 失敗 ${fail}件 / 合格 ${pass}件 ——` : `—— 全合格 ✅（${pass}件）——`);
process.exit(fail ? 1 : 0);
