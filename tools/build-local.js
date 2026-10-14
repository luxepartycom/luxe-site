#!/usr/bin/env node
/* ローカルでサイトを生成する。GAS と同じ render.js を使うので出力は一致する。
   使い方: node tools/build-local.js [sample/sheet-sample.json]  */
const fs = require('fs');
const path = require('path');
const R = require('../_shared/render.js');

const os = require('os');
const ROOT = path.join(__dirname, '..');
/* 出力先。既定はリポジトリ直下（従来どおり）。検査用に LUXE_OUT で一時ディレクトリへ逃がせる。
   読み取り元（テンプレート・assets・入力）は常に ROOT。消してよい場所以外は拒否する。 */
const OUT = (function () {
  const v = process.env.LUXE_OUT;
  if (!v) return ROOT;
  const o = path.resolve(v);
  const tmp = fs.realpathSync(os.tmpdir());
  // 実在する最も近い祖先を実体パスに解いてから判定する（symlink で外へ逃げる指定を止める）
  let anc = o, rest = '';
  while (!fs.existsSync(anc)) { rest = path.join(path.basename(anc), rest); anc = path.dirname(anc); }
  const real = path.join(fs.realpathSync(anc), rest);
  if (!real.startsWith(tmp + path.sep)) {
    console.error('LUXE_OUT は一時ディレクトリ配下のみ指定できる: ' + o + ' (実体: ' + real + ')');
    process.exit(2);
  }
  return real;
})();
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

/* LINE モードのイベントは遷移先が必須。生成ディレクトリを消す前に止める（途中で落ちて空のサイトを残さない） */
const lineUrlDefault = (cfg.sns && cfg.sns.line) || '';
for (const e of published) {
  if (!R.isLineMode(e)) continue;
  const u = R.lineHref(e, { lineUrl: lineUrlDefault });
  let okUrl = false;
  try { const x = new URL(u); okUrl = /^https:\/\/[^\/]/.test(u) && x.protocol === 'https:' && !!x.hostname; } catch (e) {}
  if (!okUrl) {
    console.error('ctaMode=line なのに LINE の遷移先が無い/https でない: ' + e.id + ' -> "' + u + '"');
    process.exit(1);
  }
}

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
    lineUrl: lineUrlDefault,
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

/* ---- プロモーター専用サイト /p/<slug>/（2026-08-07 追加）------------------
   /invite/<slug>/ が「関係者向け無料招待」（type=free・料金表なし・VIP導線なし）
   なのに対し、こちらは本編と同じ通常サイト（有料チケット＋VIP）のまま
   プロモーターだけを固定した版。知人へ直接配る前提のリンク。

   VIP導線の違い（オーナー判断 2026-08-07）:
     公開サイト … VIPボタンは LINE（相談を挟む接客導線・従来どおり）
     /p/<slug>/ … VIPボタンは vip-plan.html へ直行し promoter を固定
       → LINEは外部サービスでURLパラメータが消えるため、
         LINE経由ではVIPの紹介者を機械的に記録できない。直行にして初めて
         vip_reservations.invited_by に自動記録される。

   検索エンジンには出さない（noindex）。本編と内容が重複するため、
   出すと公開サイト側のSEOを食い合う。 */
const VIP_PLAN_BASE = 'https://entry.luxepartytokyo.com/vip-plan.html';
/* プロモーター経由のVIP申込で使う支払方法。申込ページ(vip-plan.html)は ?pay= を
   受け取るとその方法に固定し、選択ボタンも1つになる。
     'stripe'   … カード決済のみ（即時確定・回収漏れなし。決済手数料がかかる）
     'transfer' … 銀行振込のみ（手数料ゼロ。入金確認と督促が発生する）
     ''         … 従来どおり両方から選ばせる
   /p/?n=名前&pay=stripe のようにURLで上書きもできる（実行時スニペット側で処理）。 */
const VIP_PAY_MODE = 'transfer';   // 2026-08-07 オーナー指示により銀行振込固定
/* VIP申込URLのイベントIDは、サイト内部のスラッグ（2026-08-09-luxe-pool-party）ではなく
   予約システム側のID（EV-XXXXXXX）でなければ申込が成立しない。
   両者は別物なので、必ず entryUrl の e= から取り出して使う。 */
function gasEventId(ev) {
  const m = String((ev && ev.entryUrl) || '').match(/[?&]e=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function vipPlanUrl(ev, promoter) {
  const eid = gasEventId(ev);
  if (!eid) return '';   // 取り出せない＝壊れたVIPリンクを出すくらいなら出さない
  let u = VIP_PLAN_BASE + '?e=' + encodeURIComponent(eid);
  if (VIP_PAY_MODE) u += '&pay=' + encodeURIComponent(VIP_PAY_MODE);
  return withPromoter(u, promoter);
}
// 通常サイトのまま promoter だけ固定したイベントデータ（有料URL・VIPは申込ページ直行）
function promoterEventFor(promoter) {
  return current ? Object.assign({}, current, {
    entryUrl: withPromoter(current.entryUrl, promoter),   // type=paid のまま
    vipUrl:   vipPlanUrl(current, promoter)
  }) : null;
}
// 本文ブロックのCTAリンクにも promoter を付ける（見出し等は本編のまま触らない）
function promoterBlocksFor(id, promoter) {
  return blocksFor(id).map(b => {
    if (String(b.type || '').toLowerCase() === 'entry') {
      return Object.assign({}, b, { link: withPromoter(b.link, promoter) });
    }
    return b;
  });
}

/* ---- /p/ 実行時方式（デプロイ不要でプロモーターを増やせる）------------------
   /p/<slug>/ は1人につき1ファイルを生成するため、追加のたびにビルドと
   デプロイ（オーナー端末での push）が必要になり、人数が増えると回らない。
   そこで /p/index.html を1枚だけ置き、?n=<名前> を読んで申込リンクへ
   promoter を実行時に付ける。以後は URL を渡すだけで新しいプロモーターに対応できる。

   申込システムは別ドメイン（entry.luxepartytokyo.com）なので、
   ブラウザの保存領域は共有されない。よってリンクに埋め込む方式でしか渡せない。
   逆に、一度リンクを踏めば以降は申込システム側が保持するため、
   Stripe決済へ遷移しても帰属は失われない（決済前にサーバへ記録済み）。 */
/* ---- 開催終了後の自動切替（2026-08-10 追加）--------------------------------
   これまで「終了したか」はサイトを生成した瞬間にしか判定しておらず、
   イベントが終わっても誰かが作り直すまでチケット購入ボタンが残り続けていた
   （8/9のPOOL PARTY終了後も購入CTAが3箇所公開されたまま）。

   終了時刻をページに埋め込み、開いた瞬間にブラウザ側で判定する方式にする。
   ・再ビルドもデプロイも不要。以後どのイベントでも自動で効く
   ・終了時刻を過ぎた瞬間から切り替わる（日をまたぐ待ち時間が無い）
   ・CTAを消すだけだと行き止まりになるため、次回集客の導線（LINE/Instagram）へ差し替える
   次のイベントをシートに登録して再生成すれば、トップは自動で次回へ切り替わる（既存の仕組み）。 */
function eventEndMsFor(ev) {
  const d = String((ev && ev.date) || '').split('-');
  if (d.length !== 3) return 0;
  const open = String(ev.open || '00:00').split(':');
  const close = String(ev.close || '23:59').split(':');
  const base = Date.UTC(+d[0], +d[1] - 1, +d[2], 0, 0, 0) - 9 * 3600 * 1000; // JST 00:00
  const closeMin = (+close[0]) * 60 + (+close[1] || 0);
  const openMin  = (+open[0]) * 60 + (+open[1] || 0);
  return base + ((closeMin <= openMin ? 1 : 0) * 24 * 60 + closeMin) * 60 * 1000;
}

function endedSnippet(ev, lang) {
  const endMs = eventEndMsFor(ev);
  if (!endMs) return '';
  // イベント専用の追加URLがあれば終了後もそれを使う（経路別の数を途切れさせない）
  const line = (ev && ev.lineUrl) || (cfg.sns && cfg.sns.line) || '';
  const ig   = (cfg.sns && cfg.sns.instagram) || '';
  const T = lang === 'en'
    ? { notice:'This event has ended. Please stay tuned for the next one.',
        line:'Get updates on LINE', ig:'Follow on Instagram', badge:'ENDED' }
    : { notice:'本イベントは終了しました。次回開催をお待ちください。',
        line:'LINEで次回のご案内を受け取る', ig:'Instagramをフォロー', badge:'開催終了' };
  return [
'<script>',
'(function(){',
'  // 開催終了時刻（ミリ秒・JST基準で算出済み）。過ぎていたら購入導線を次回集客へ差し替える。',
'  var END = ' + endMs + ';',
'  if (Date.now() < END) return;',
'  var LINE = ' + JSON.stringify(line) + ', IG = ' + JSON.stringify(ig) + ';',
'  function repl(el, href, text, cls) {',
'    if (!el) return;',
'    if (!href) { el.remove(); return; }',
'    el.setAttribute("href", href);',
'    el.setAttribute("target", "_blank");',
'    el.setAttribute("rel", "noopener");',
'    el.textContent = text;',
'    if (cls) el.className = cls;',
'  }',
'  // ヒーロー：主ボタン=LINE、副ボタン（過去のイベント）はそのまま残す',
'  var hero = document.querySelector(".hero-cta .btn-fill");',
'  repl(hero, LINE, ' + JSON.stringify(T.line) + ', "btn btn-fill");',
'  // 常時表示バー：チケット→LINE、VIP→Instagram',
'  repl(document.querySelector(".sticky-cta .scta-fill"), LINE, ' + JSON.stringify(T.line) + ', "scta-btn scta-fill");',
'  repl(document.querySelector(".sticky-cta .scta-line"), IG,   ' + JSON.stringify(T.ig)   + ', "scta-btn scta-line");',
'  // ヘッダーの小さなCTA',
'  repl(document.querySelector(".cta-mini"), LINE, "LINE", "cta-mini");',
'  // 本文中のエントリーセクションのボタン（ヒーロー以外）',
'  Array.prototype.forEach.call(document.querySelectorAll(".sec .hero-cta .btn-fill"), function (b) {',
'    repl(b, LINE, ' + JSON.stringify(T.line) + ', "btn btn-fill");',
'  });',
'  // 終了した旨を明示する。黙って差し替えるとお客様が混乱するため。',
'  var host = document.querySelector(".hero-cta");',
'  if (host && !document.getElementById("ended-notice")) {',
'    var n = document.createElement("div");',
'    n.id = "ended-notice";',
'    n.style.cssText = "margin-bottom:14px;font-size:0.72rem;letter-spacing:0.08em;color:#D8B26A;line-height:1.9;";',
'    n.textContent = ' + JSON.stringify(T.notice) + ';',
'    host.parentNode.insertBefore(n, host);',
'  }',
'  document.documentElement.setAttribute("data-event-ended", "1");',
'  // 終了告知を動画ファーストのヒーローで隠さない（最初から全部見せる）',
'  document.documentElement.classList.remove("hero-gate", "hero-revealed");',
'})();',
'</script>'
  ].join('\n');
}

function withEndedRuntime(html, ev, lang) {
  const s = endedSnippet(ev, lang);
  if (!s) return html;
  return html.indexOf('</body>') >= 0 ? html.replace('</body>', s + '\n</body>') : html + s;
}

const PROMOTER_RUNTIME_SNIPPET = [
'<script>',
'(function(){',
'  // /p/?n=<プロモーター名> … このページ配下の申込リンクを全てそのプロモーターに固定する。',
'  var q = new URLSearchParams(location.search);',
'  var n = (q.get("n") || q.get("p") || q.get("promoter") || "").trim();',
'  // サイト内を回遊してパラメータが落ちても維持できるよう保持する（同一オリジン内のみ有効）',
'  try {',
'    if (n) sessionStorage.setItem("luxe_promoter", n);',
'    else   n = sessionStorage.getItem("luxe_promoter") || "";',
'  } catch (e) {}',
'  // VIPの支払方法を URL で切り替える',
'  //   ?pay=transfer … 銀行振込のみ',
'  //   ?pay=stripe   … カード決済のみ',
'  //   ?pay=both     … 両方から選ばせる（埋め込み済みの pay= を取り除く）',
'  //   指定なし      … ビルド時の既定のまま',
'  var pay = (q.get("pay") || "").trim().toLowerCase();',
'  var payBoth = (pay === "both" || pay === "all" || pay === "any");',
'  if (!payBoth && pay !== "stripe" && pay !== "transfer") pay = "";',
'  if (!n && !pay && !payBoth) return;   // 何も無ければ通常サイトとして振る舞う（リンクは素のまま）',
'  var enc = n ? encodeURIComponent(n) : "";',
'  // クエリから pay= だけを安全に取り除く（文字列置換だと ? や & が壊れやすい）',
'  function stripPay(u) {',
'    var i = u.indexOf("?");',
'    if (i < 0) return u;',
'    var base = u.slice(0, i);',
'    var kept = [];',
'    u.slice(i + 1).split("&").forEach(function (kv) { if (kv.indexOf("pay=") !== 0) kept.push(kv); });',
'    return kept.length ? base + "?" + kept.join("&") : base;',
'  }',
'  var as = document.querySelectorAll(\'a[href^="https://entry.luxepartytokyo.com/"]\');',
'  Array.prototype.forEach.call(as, function (a) {',
'    var h = a.getAttribute("href") || "";',
'    // VIP申込リンクだけ支払方法を差し替える（既存の pay= があれば置換／両方指定なら除去）',
'    if (h.indexOf("vip-plan.html") >= 0) {',
'      if (payBoth) {',
'        h = stripPay(h);',
'      } else if (pay) {',
'        h = /[?&]pay=/.test(h) ? h.replace(/([?&]pay=)[^&]*/, "$1" + pay)',
'                               : h + (h.indexOf("?") >= 0 ? "&" : "?") + "pay=" + pay;',
'      }',
'    }',
'    if (enc && h.indexOf("promoter=") < 0) {   // 既に固定済みなら触らない',
'      h = h + (h.indexOf("?") >= 0 ? "&" : "?") + "promoter=" + enc;',
'    }',
'    a.setAttribute("href", h);',
'  });',
'  if (!enc) return;   // 名前が無ければサイト内リンクの引き継ぎは不要',
'  // サイト内の他ページへ移動しても名前が続くようにする',
'  var ins = document.querySelectorAll(\'a[href]:not([href^="http"])\');',
'  Array.prototype.forEach.call(ins, function (a) {',
'    var h = a.getAttribute("href") || "";',
'    if (h.charAt(0) === "#" || h.indexOf("n=") >= 0) return;',
'    a.setAttribute("href", h + (h.indexOf("?") >= 0 ? "&" : "?") + "n=" + enc);',
'  });',
'})();',
'</script>'
].join('\n');

function withPromoterRuntime(html) {
  return html.indexOf('</body>') >= 0
    ? html.replace('</body>', PROMOTER_RUNTIME_SNIPPET + '\n</body>')
    : html + PROMOTER_RUNTIME_SNIPPET;
}
/* LINE モード時の派生URL（/invite/・/p/）。配布済みのURLを404にせず、トップへ送るだけのページにする。
   申込リンクも重複コンテンツも残さない。計測はトップ側で行われる。 */
function redirectHtml(to, lang) {
  const top = cfg.baseUrl + (lang === 'en' ? 'en/' : '');
  return '<!doctype html><html lang="' + (lang === 'en' ? 'en' : 'ja') + '"><head><meta charset="utf-8">' +
    '<meta name="robots" content="noindex, follow">' +
    '<meta http-equiv="refresh" content="0; url=' + to + '">' +
    '<link rel="canonical" href="' + R.esc(top) + '">' +
    '<title>' + R.esc(cfg.siteName) + '</title>' +
    '<script>location.replace(' + JSON.stringify(to) + ');</script></head>' +
    '<body><a href="' + to + '">' + R.esc(cfg.siteName) + '</a></body></html>';
}

function write(rel, html) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
  console.log('  wrote', rel, '(' + Math.round(html.length / 1024) + 'KB)');
}

// 生成ディレクトリを一旦クリーン（削除済みイベントの残骸ページを残さない）
['events', 'en', 'archive', 'invite', 'p'].forEach(function (d) {
  try { fs.rmSync(path.join(OUT, d), { recursive: true, force: true }); } catch (e) {}
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
  if (current) write(`${L.prefix}index.html`, withEndedRuntime(
    R.renderEventPage(tplEvent, current, blocksFor(current.id), ctxFor(L.baseIndex, '', L.lang)), current, L.lang));

  /* 個別ページ（全イベント分。アーカイブからの遷移先） */
  for (const ev of published) {
    write(`${L.prefix}events/${ev.id}/index.html`, withEndedRuntime(
      R.renderEventPage(tplEvent, ev, blocksFor(ev.id), ctxFor(L.baseEvent, `events/${ev.id}/`, L.lang)), ev, L.lang));
  }

  /* アーカイブ = 終了済みのみ */
  write(`${L.prefix}archive/index.html`,
    R.renderArchivePage(tplArchive, past, ctxFor(L.baseArchive, 'archive/', L.lang)));

  /* 関係者向け無料招待（限定公開・noindex・sitemap非掲載・robotsでDisallow）。
     本編と同一コンテンツ／演出で、CTA=無料で申し込む・entryUrl=type=free・料金表なし・VIP導線なし・招待バッジあり。 */
  if (current && R.isLineMode(current)) {
    /* LINE モード：招待・プロモーター用ページは作らない（2026-10-14 オーナー方針）。
       旧URLは言語トップへ転送する。 */
    const toTop = '../';   // /invite/ → 言語トップ（ja=/、en=/en/）
    write(`${L.prefix}invite/index.html`, redirectHtml(toTop, L.lang));
    write(`${L.prefix}p/index.html`, redirectHtml(toTop, L.lang));
    for (const P of PROMOTERS) {
      write(`${L.prefix}invite/${P.slug}/index.html`, redirectHtml('../' + toTop, L.lang));
      write(`${L.prefix}p/${P.slug}/index.html`, redirectHtml('../' + toTop, L.lang));
    }
  } else {
  if (inviteEvent) {
    /* /invite/?n=<名前> でも紹介者を固定できるようにする（/p/ と同じ実行時方式）。
       これで PROMOTERS に載っていない人へも、その場で無料招待URLを発行できる。
       ページの中身は従来の無料招待そのまま（type=free・料金表なし・VIP導線なし・招待バッジあり）で、
       追加されるのは申込リンクへの promoter 付与だけ。?n= が無ければ従来と完全に同じ。 */
    write(`${L.prefix}invite/index.html`, withEndedRuntime(withPromoterRuntime(
      R.renderEventPage(tplEvent, inviteEvent, inviteBlocksFor(current.id), ctxFor(L.baseArchive, 'invite/', L.lang, { invite: true, noindex: true }))), current, L.lang));
    /* プロモーター固定の招待バリアント（CTA遷移先に promoter を固定・限定公開）。/invite/<slug>/ は invite/ より1階層深い。
       こちらは promoter を埋め込み済みの静的ページのまま。実行時スニペットは入れない
       （?n= で別人に上書きできてしまうと、配った本人の実績が横取りされ得るため）。 */
    for (const P of PROMOTERS) {
      write(`${L.prefix}invite/${P.slug}/index.html`, withEndedRuntime(
        R.renderEventPage(tplEvent, inviteEventFor(P.promoter), inviteBlocksFor(current.id, P.promoter), ctxFor(L.baseArchive + '../', `invite/${P.slug}/`, L.lang, { invite: true, noindex: true })), current, L.lang));
    }
  }

  /* プロモーター専用サイト /p/<slug>/（限定公開・noindex）。
     本編と同一の通常サイト（有料チケット＋VIP）で、遷移先だけ promoter 固定。
     invite: true を渡さないので、料金表もVIPボタンも本編どおり出る。
     階層は invite/<slug>/ と同じ深さなので base も同じ扱い。 */
  if (current) {
    for (const P of PROMOTERS) {
      write(`${L.prefix}p/${P.slug}/index.html`, withEndedRuntime(
        R.renderEventPage(tplEvent, promoterEventFor(P.promoter), promoterBlocksFor(current.id, P.promoter), ctxFor(L.baseArchive + '../', `p/${P.slug}/`, L.lang, { noindex: true })), current, L.lang));
    }

    /* /p/ 1枚で全プロモーターを賄う版（?n=<名前>）。
       promoter を空でレンダリングし、リンクの付与は実行時スニペットに任せる。
       これにより新しいプロモーターの追加にビルドもデプロイも要らなくなる。 */
    write(`${L.prefix}p/index.html`, withEndedRuntime(withPromoterRuntime(
      R.renderEventPage(tplEvent, promoterEventFor(''), promoterBlocksFor(current.id, ''), ctxFor(L.baseArchive, 'p/', L.lang, { noindex: true }))), current, L.lang));
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
