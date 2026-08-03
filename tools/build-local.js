#!/usr/bin/env node
/* ローカルでサイトを生成する。GAS と同じ render.js を使うので出力は一致する。
   使い方: node tools/build-local.js [sample/sheet-sample.json]  */
const fs = require('fs');
const path = require('path');
const R = require('../_shared/render.js');

const ROOT = path.join(__dirname, '..');
const src = process.argv[2] || path.join(ROOT, 'sample/sheet-sample.json');
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const cfg = data.config;
const now = Date.now();

/* assets/ を走査してマニフェストを作る（GAS 側は commit 時に同じ形を作る） */
const assets = {};
const assetsDir = path.join(ROOT, 'assets');
for (const eid of fs.readdirSync(assetsDir)) {
  const dir = path.join(assetsDir, eid);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    // 出力名 hero.a1b2c3.jpg -> 元名 hero.jpg
    const m = f.match(/^(.+)\.[0-9a-f]{6,}(\.[a-z0-9]+)$/i);
    const orig = m ? m[1] + m[2] : f;
    assets[eid + '/' + orig] = 'assets/' + eid + '/' + f;
  }
}

const brandHtml = `${R.esc(cfg.brandLine1)} <span>${R.esc(cfg.brandAccent)}</span> ${R.esc(cfg.brandLine2)}`;
const snsHtml = R.snsHtml(cfg.sns);

const published = data.events.filter(e => e.published !== false);
const upcoming = published.filter(e => !R.isPast(e, now)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
const past = published.filter(e => R.isPast(e, now));
const current = upcoming[0] || past.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
// 前回イベント＝直近の終了イベント（現在表示中のイベント自身は除く）
const prevEvent = past
  .filter(e => !current || e.id !== current.id)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;

const tplEvent = fs.readFileSync(path.join(ROOT, '_templates/event.html'), 'utf8');
const tplArchive = fs.readFileSync(path.join(ROOT, '_templates/archive.html'), 'utf8');
const tpl404 = fs.readFileSync(path.join(ROOT, '_templates/404.html'), 'utf8');

function blocksFor(id) {
  return data.blocks
    .filter(b => b.eventId === id && b.published !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}
function ctxFor(base, suffix, lang) {
  return {
    base, suffix, lang, now, assets, siteName: cfg.siteName, baseUrl: cfg.baseUrl, brandHtml, snsHtml,
    ga4Id: cfg.ga4Id || '', metaPixelId: cfg.metaPixelId || '', prevEvent,
    pastEvents: past
      .filter(e => !current || e.id !== current.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  };
}
function write(rel, html) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
  console.log('  wrote', rel, '(' + Math.round(html.length / 1024) + 'KB)');
}

console.log('building…');

/* 言語ごとにサイト一式を生成する。ja はルート、en は /en/ 配下。
   base はサイトルート相対（en ページは ja 相当より1階層深いので '../' を足す）。 */
const LANGS = [
  { lang: 'ja', prefix: '', baseIndex: '', baseEvent: '../../', baseArchive: '../' },
  { lang: 'en', prefix: 'en/', baseIndex: '../', baseEvent: '../../../', baseArchive: '../../' }
];

for (const L of LANGS) {
  /* トップ = 直近の開催予定イベント */
  if (current) write(`${L.prefix}index.html`,
    R.renderEventPage(tplEvent, current, blocksFor(current.id), ctxFor(L.baseIndex, '', L.lang)));

  /* 個別ページ（全イベント分。アーカイブからの遷移先） */
  for (const ev of published) {
    write(`${L.prefix}events/${ev.id}/index.html`,
      R.renderEventPage(tplEvent, ev, blocksFor(ev.id), ctxFor(L.baseEvent, `events/${ev.id}/`, L.lang)));
  }

  /* アーカイブ = 終了済みのみ */
  write(`${L.prefix}archive/index.html`,
    R.renderArchivePage(tplArchive, past, ctxFor(L.baseArchive, 'archive/', L.lang)));
}

/* 404・sitemap・robots（GAS 本番と同じ出力） */
write('404.html', R.render404Page(tpl404, ctxFor('', '', 'ja')));
const suffixes = [''].concat(published.map(ev => `events/${ev.id}/`)).concat(['archive/']);
write('sitemap.xml', R.renderSitemap(suffixes, cfg));
write('robots.txt', R.renderRobots(cfg));

/* 構造化データ（バックアップも兼ねる） */
write('data/site.json', JSON.stringify({ generatedAt: new Date().toISOString(), config: cfg, events: published, blocks: data.blocks, assets }, null, 2));

console.log(`done. current=${current ? current.id : 'none'} upcoming=${upcoming.length} past=${past.length}`);
