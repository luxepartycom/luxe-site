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
function ctxFor(base, suffix, lang, opts) {
  return Object.assign({
    base, suffix, lang, now, assets, siteName: cfg.siteName, baseUrl: cfg.baseUrl, brandHtml, snsHtml,
    ga4Id: cfg.ga4Id || '', metaPixelId: cfg.metaPixelId || '', prevEvent,
    pastEvents: past
      .filter(e => !current || e.id !== current.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }, opts || {});
}

/* ---- 関係者向け無料招待（限定公開）用の変種データ。本編は非破壊、招待は追加ページのみ。
   entryUrl は無料URL(type=free)、VIP導線は空、料金表(table)は render 側で非表示、
   購入系ラベルは招待CTA(無料で申し込む/RSVP FREE)へ差し替える。 */
function toFreeUrl(u) {
  const s = String(u || '');
  if (!s) return s;
  if (/[?&]type=paid\b/.test(s)) return s.replace(/([?&]type=)paid\b/, '$1free');
  if (/[?&]type=free\b/.test(s)) return s;
  return s + (s.indexOf('?') >= 0 ? '&' : '?') + 'type=free';
}
// promoter を無料URLに付与（固定プロモーターの招待リンク用）。申込の invited_by がこの値になる。
function withPromoter(u, promoter) {
  const s = String(u || '');
  if (!s || !promoter) return s;
  return s + (s.indexOf('?') >= 0 ? '&' : '?') + 'promoter=' + encodeURIComponent(promoter);
}
// 招待版イベント（promoter を渡すとCTA遷移先に promoter を固定）
function inviteEventFor(promoter) {
  return current ? Object.assign({}, current, {
    entryUrl: withPromoter(toFreeUrl(current.entryUrl), promoter),
    vipUrl: ''
  }) : null;
}
const inviteEvent = inviteEventFor(null);
function inviteBlocksFor(id, promoter) {
  return blocksFor(id).map(b => {
    if (String(b.type || '').toLowerCase() === 'entry') {
      // エントリCTAのリンクを無料URL(＋promoter固定)へ、見出しの「チケットのご購入」を申し込みへ差し替え
      return Object.assign({}, b, { link: withPromoter(toFreeUrl(b.link), promoter), title: 'ENTRY|お申し込み', title_en: 'ENTRY|RSVP' });
    }
    return b;
  });
}
// 固定プロモーター（各自にこの限定URLを渡す→申込の invited_by が自動でこの値になる）
const PROMOTERS = [
  { slug: 'daiko', promoter: 'LUXE_Daiko' },
  { slug: 'ren',   promoter: 'LUXE_Ren' },
  { slug: 'ryu',   promoter: 'LUXE_Ryu' }
];
function write(rel, html) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
  console.log('  wrote', rel, '(' + Math.round(html.length / 1024) + 'KB)');
}

// 生成ディレクトリを一旦クリーン（削除済みイベントの残骸ページを残さない）
['events', 'en', 'archive', 'invite'].forEach(function (d) {
  try { fs.rmSync(path.join(ROOT, d), { recursive: true, force: true }); } catch (e) {}
});

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

  /* 関係者向け無料招待（限定公開・noindex・sitemap非掲載・robotsでDisallow）。
     本編と同一コンテンツ／演出で、CTA=無料で申し込む・entryUrl=type=free・料金表なし・VIP導線なし・招待バッジあり。 */
  if (inviteEvent) {
    write(`${L.prefix}invite/index.html`,
      R.renderEventPage(tplEvent, inviteEvent, inviteBlocksFor(current.id), ctxFor(L.baseArchive, 'invite/', L.lang, { invite: true, noindex: true })));
    /* プロモーター固定の招待バリアント（CTA遷移先に promoter を固定・限定公開）。/invite/<slug>/ は invite/ より1階層深い。 */
    for (const P of PROMOTERS) {
      write(`${L.prefix}invite/${P.slug}/index.html`,
        R.renderEventPage(tplEvent, inviteEventFor(P.promoter), inviteBlocksFor(current.id, P.promoter), ctxFor(L.baseArchive + '../', `invite/${P.slug}/`, L.lang, { invite: true, noindex: true })));
    }
  }
}

/* 404・sitemap・robots（GAS 本番と同じ出力） */
write('404.html', R.render404Page(tpl404, ctxFor('', '', 'ja')));
const suffixes = [''].concat(published.map(ev => `events/${ev.id}/`)).concat(['archive/']);
write('sitemap.xml', R.renderSitemap(suffixes, cfg));
write('robots.txt', R.renderRobots(cfg));

/* 構造化データ（バックアップも兼ねる） */
write('data/site.json', JSON.stringify({ generatedAt: new Date().toISOString(), config: cfg, events: published, blocks: data.blocks, assets }, null, 2));

console.log(`done. current=${current ? current.id : 'none'} upcoming=${upcoming.length} past=${past.length}`);
