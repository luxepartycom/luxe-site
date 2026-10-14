#!/usr/bin/env node
/* ctaMode=line（導線を公式LINEの友だち追加に一本化）の検査。2026-10-14
   架空の開催予定イベントを一時ディレクトリへ生成して、実際の出力HTMLを見る。
   使い方: NODE_PATH=~/.cache/claude-node/node_modules node tools/verify-line-mode.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { JSDOM } = require('jsdom');
const R = require('../_shared/render.js');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(__dirname, 'build-local.js');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample/sheet-sample.json'), 'utf8'));
const ENTRY_DOMAIN = 'entry.luxepartytokyo.com';
const LINE = base.config.sns.line;
const DEDICATED = 'https://lin.ee/TEST-site-only';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } }

// 30日後に開催する LINE モードのイベント。申込URL・VIP・申込ブロック・料金表をわざと入れて、出ないことを確かめる
const d = new Date(Date.now() + 30 * 86400000 + 9 * 3600000);
const date = d.toISOString().slice(0, 10);
const EID = date + '-line-test';
function fixture(opts) {
  const f = JSON.parse(JSON.stringify(base));
  // 実データの開催予定イベントは外す（このテストのイベントを必ずトップにするため）
  f.events = f.events.filter(e => R.isPast(e, Date.now()));
  Object.assign(f.config, opts.config || {});
  f.events.push(Object.assign({
    id: EID, title: 'LINE TEST NIGHT', date, day: 'SAT', open: '20:00', close: '04:00',
    venue: 'TEST VENUE', lead: 'test', published: true, ctaMode: 'line',
    entryUrl: 'https://' + ENTRY_DOMAIN + '/index.html?e=EV-TEST&type=paid',
    vipUrl: 'https://' + ENTRY_DOMAIN + '/vip-plan.html?e=EV-TEST'
  }, opts.event || {}));
  f.blocks.push(
    { eventId: EID, order: 1, type: 'entry', title: 'ENTRY|入場', body: '本文', link: 'https://' + ENTRY_DOMAIN + '/index.html?e=EV-TEST&type=paid', published: true },
    { eventId: EID, order: 2, type: 'table', title: 'ENTRANCE|入場', body: 'MEN|¥20,000', published: true },
    { eventId: EID, order: 3, type: 'table', variant: 'vip', body: 'VIP SEAT | RAISE | ASK | LINEで', published: true }
  );
  return f;
}
function build(name, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luxe-line-' + name + '-'));
  const src = path.join(dir, 'in.json');
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'MARKER'), 'x');
  fs.writeFileSync(src, JSON.stringify(fixture(opts)));
  const r = spawnSync('node', [BUILD, src], { env: Object.assign({}, process.env, { LUXE_OUT: out }), encoding: 'utf8' });
  return { out, status: r.status, stderr: r.stderr, read: rel => fs.readFileSync(path.join(out, rel), 'utf8') };
}
function allHtml(dir) {
  const res = [];
  (function walk(p) {
    for (const f of fs.readdirSync(p)) {
      const q = path.join(p, f);
      if (fs.statSync(q).isDirectory()) walk(q); else if (f.endsWith('.html')) res.push(q);
    }
  })(dir);
  return res;
}

console.log('A. 計測IDあり・共通LINE');
const A = build('a', { config: { ga4Id: 'G-TEST123', metaPixelId: '123456' } });
ok(A.status === 0, 'ビルド成功 (' + A.stderr + ')');
for (const lang of ['', 'en/']) {
  const html = A.read(lang + 'index.html');
  const doc = new JSDOM(html).window.document;
  const tag = lang || 'ja/';
  ok(html.indexOf('LINE TEST NIGHT') >= 0, tag + 'トップが LINE モードのイベント');
  ok(html.indexOf(ENTRY_DOMAIN) < 0, tag + 'トップに申込ドメインが0件（JSON-LD含む）');
  ok(html.indexOf('vip-plan') < 0, tag + 'VIP申込リンクが無い');
  ok(html.indexOf('チケットを購入する') < 0 && html.indexOf('BUY TICKET') < 0, tag + '購入文言が無い');
  const cta = doc.querySelectorAll('[data-cta="line"]');
  const pos = Array.from(cta).map(a => a.getAttribute('data-cta-pos')).sort().join(',');
  ok(pos === 'entry,header,hero,sticky,vip', tag + 'LINEへのリンクが hero/header/sticky/entry/vip の5箇所 (' + pos + ')');
  ok(Array.from(cta).every(a => a.getAttribute('href') === LINE), tag + '全ボタンの遷移先が config.sns.line');
  ok(doc.querySelectorAll('.sticky-cta .scta-btn').length === 1, tag + '常時バーのボタンは1つ（VIPなし）');
  ok(doc.querySelector('.hero-cta .btn-fill') && doc.querySelector('.hero-cta .btn-fill').getAttribute('data-cta') === 'line', tag + '終了後スニペットが掴むヒーロー主ボタン＝LINE');
  const ld = doc.querySelector('script[type="application/ld+json"]');
  ok(ld && !('offers' in JSON.parse(ld.textContent)), tag + 'JSON-LD に offers が無い');
  ok((html.match(/window\.__luxeLineTrack=1/g) || []).length === 1, tag + '計測リスナーは1つ');
  ok(html.indexOf('ENTRANCE') >= 0, tag + '料金表ブロックは入力どおり出す（隠さない）');
}
// 計測：クリック1回で GA4・Meta が各1回
{
  const dom = new JSDOM(A.read('index.html'), { runScripts: 'dangerously' });
  const w = dom.window; const calls = [];
  w.gtag = function () { calls.push(['ga'].concat([].slice.call(arguments))); };
  w.fbq = function () { calls.push(['px'].concat([].slice.call(arguments))); };
  w.document.querySelector('.sticky-cta [data-cta="line"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const ga = calls.filter(c => c[0] === 'ga' && c[1] === 'event');
  const px = calls.filter(c => c[0] === 'px' && c[1] === 'trackCustom');
  ok(ga.length === 1 && ga[0][2] === 'line_click' && ga[0][3].position === 'sticky', 'クリックで GA4 line_click(position=sticky) が1回');
  ok(px.length === 1 && px[0][2] === 'LineClick', 'クリックで Meta LineClick が1回');
  calls.length = 0;
  w.document.querySelector('.lang-switch').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  ok(calls.filter(c => c[1] === 'event' || c[1] === 'trackCustom').length === 0, 'LINE以外のクリックは送らない');
}
// 派生URL：転送ページになり、申込導線が残らない
const derived = ['invite/index.html', 'p/index.html', 'invite/daiko/index.html', 'p/ryu/index.html',
  'en/invite/index.html', 'en/p/index.html', 'en/p/ren/index.html'];
for (const rel of derived) {
  const h = A.read(rel);
  const depth = rel.replace(/^en\//, '').split('/').length - 1;
  const to = '../'.repeat(depth);
  ok(h.indexOf('location.replace("' + to + '")') >= 0 && h.indexOf('noindex') >= 0, rel + ' は言語トップ(' + to + ')への noindex 転送');
  ok(h.indexOf(ENTRY_DOMAIN) < 0 && h.indexOf('luxe_promoter') < 0, rel + ' に申込リンク・promoter処理が無い');
  const en = rel.indexOf('en/') === 0;
  ok(h.indexOf('<html lang="' + (en ? 'en' : 'ja') + '">') >= 0, rel + ' の lang');
  ok(h.indexOf('rel="canonical" href="' + base.config.baseUrl + (en ? 'en/' : '') + '"') >= 0, rel + ' の canonical が言語トップ');
}
// 転送先が実在する（相対パスの解決）
for (const rel of derived) {
  const depth = rel.replace(/^en\//, '').split('/').length - 1;
  const target = path.join(A.out, path.dirname(rel), '../'.repeat(depth), 'index.html');
  ok(fs.existsSync(target) && fs.readFileSync(target, 'utf8').indexOf('LINE TEST NIGHT') >= 0, rel + ' の転送先がLINEモードのトップ');
}
// 生成物全体：申込ドメインが残るのは過去イベントの個別ページだけ
for (const f of allHtml(A.out)) {
  const rel = path.relative(A.out, f);
  if (/events\/(?!.*line-test)/.test(rel)) continue;   // 終了済みイベントの記録ページは対象外
  ok(fs.readFileSync(f, 'utf8').indexOf(ENTRY_DOMAIN) < 0, rel + ' に申込ドメインが無い');
}
ok(A.read('sitemap.xml').indexOf('/p/') < 0 && A.read('sitemap.xml').indexOf('/invite/') < 0, 'sitemap に転送ページが載らない');

console.log('B. 計測IDなし');
const B = build('b', { config: { ga4Id: '', metaPixelId: '' } });
ok(B.status === 0, 'ビルド成功');
ok(B.read('index.html').indexOf('__luxeLineTrack') < 0, 'ID未設定なら計測リスナーを出さない');

console.log('C. LINEの遷移先が空なら止まり、既存の出力を消さない');
const C = build('c', { config: { sns: { instagram: base.config.sns.instagram, line: '' } } });
ok(C.status === 1, 'exit 1 で止まる (status=' + C.status + ')');
ok(/ctaMode=line/.test(C.stderr), '理由を出す');
ok(fs.existsSync(path.join(C.out, 'MARKER')) && !fs.existsSync(path.join(C.out, 'index.html')), '何も書かず・何も消さない');
const C2 = build('c2', { event: { lineUrl: 'http://lin.ee/insecure' } });
ok(C2.status === 1, 'http の遷移先も止める');
for (const bad of ['https://', 'https:///relative', 'lin.ee/zGh0dYy']) {
  ok(build('c3', { event: { lineUrl: bad } }).status === 1, '壊れたURL "' + bad + '" も止める');
}
// 出力先のガード：一時ディレクトリ内の symlink がリポジトリを指していても、その先を消さない
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luxe-line-link-'));
  const link = path.join(dir, 'link');
  fs.symlinkSync(ROOT, link);
  const r = spawnSync('node', [BUILD], { env: Object.assign({}, process.env, { LUXE_OUT: path.join(link, 'nonexistent') }), encoding: 'utf8' });
  ok(r.status === 2, 'symlink 経由でリポジトリを指す出力先を拒否する (status=' + r.status + ')');
  ok(fs.existsSync(path.join(ROOT, 'events')), 'リポジトリの生成物が残っている');
}

console.log('D. イベント専用の追加URL');
const D = build('d', { event: { lineUrl: DEDICATED } });
ok(D.status === 0, 'ビルド成功');
{
  const html = D.read('index.html');
  const doc = new JSDOM(html).window.document;
  ok(Array.from(doc.querySelectorAll('[data-cta="line"]')).every(a => a.getAttribute('href') === DEDICATED), '全ボタンが専用URL');
  ok(html.indexOf('var LINE = ' + JSON.stringify(DEDICATED)) >= 0, '終了後の差し替えも専用URLを使う');
  ok(doc.querySelector('footer') ? doc.querySelector('footer').innerHTML.indexOf(LINE) >= 0 : true, 'フッターのSNSは共通LINEのまま');
}

console.log('E. LINE モードでないページの VIP カードも計測する');
{
  const E = build('e', { config: { ga4Id: 'G-TEST123' }, event: { ctaMode: '' } });
  ok(E.status === 0, 'ビルド成功');
  const html = E.read('index.html');
  ok(/data-cta-pos="vip"/.test(html), 'VIP カードがある');
  ok((html.match(/window\.__luxeLineTrack=1/g) || []).length === 1, 'LINE モードでなくても VIP カードがあれば計測を入れる');
}
console.log(fail ? `—— 失敗 ${fail}件 / 合格 ${pass}件 ——` : `—— 全合格 ✅（${pass}件）——`);
process.exit(fail ? 1 : 0);
