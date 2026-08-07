/* =========================================================================
   render.js — サイト生成の唯一のロジック
   このファイルは Node（tools/build-local.js）と GAS（render.gs として貼付）の
   両方から同じ内容で使います。GAS API も Node API も使わない純粋関数のみ。
   ========================================================================= */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 日本語ファイル名・空白を安全な英数字に落とす（URL事故防止） */
function slugify(s) {
  var t = String(s || '').toLowerCase().trim()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^a-z0-9\-_.]/g, '');
  return t || 'file';
}

/* "hero.jpg|会場の外観" -> {file:"hero.jpg", alt:"会場の外観"} */
function parseImageRef(raw) {
  var parts = String(raw || '').split('|');
  return { file: parts[0].trim(), alt: (parts[1] || '').trim() };
}

function splitList(raw) {
  return String(raw || '').split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function lines(raw) {
  return String(raw || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
}

/* ---------- 多言語（i18n） ---------- */
/* UI文言の対訳表。日本語と英語で共通の骨格を持つ。 */
var UI_STRINGS = {
  ja: {
    entry: 'チケットを購入する', entryFree: '無料で申し込む', vip: 'VIPの詳細はこちら', pastEvents: '過去のイベント', currentEvent: '開催中のイベント',
    prevLabel: '前回のイベント', viewNight: 'この夜を見る', comingSoon: '近日発表',
    attention: '注意事項', privacy: 'プライバシーポリシー', tokusho: '特定商取引法に基づく表記',
    archiveEyebrow: 'Archive', archiveTitle: '過去開催<em>イベント</em>', archiveEmpty: 'まだ記録がありません。',
    switchTo: 'EN', ogLocale: 'ja_JP',
    heldAt: function (d, v) { return d + ' ' + v + ' で開催。'; },
    archiveDesc: '過去に開催したイベントの記録。',
    archiveSub: function (n) { return n + '回分の記録。'; }
  },
  en: {
    entry: 'BUY TICKET', entryFree: 'RSVP FREE', vip: 'VIP DETAILS', pastEvents: 'Past Events', currentEvent: 'Current Event',
    prevLabel: 'Previous Event', viewNight: 'View this night', comingSoon: 'Coming soon',
    attention: 'House Rules', privacy: 'Privacy Policy', tokusho: 'Commercial Transactions',
    archiveEyebrow: 'Archive', archiveTitle: 'Past <em>Events</em>', archiveEmpty: 'No records yet.',
    switchTo: '日本語', ogLocale: 'en_US',
    heldAt: function (d, v) { return d + (v ? ' at ' + v : '') + '.'; },
    archiveDesc: 'A record of every night we have held.',
    archiveSub: function (n) { return n + ' nights on record. Tap a photo to open that night.'; }
  }
};

/* 言語つきフィールド取得。英語で <field>_en が空なら日本語へフォールバック（エラーにしない）。 */
function loc(obj, field, lang) {
  if (lang === 'en') {
    var v = obj[field + '_en'];
    if (v != null && String(v).trim() !== '') return v;
  }
  return obj[field];
}

/* ページ共通の i18n 派生値（base はサイトルート、suffix は言語ルート以下のパス）。 */
function i18n(ctx) {
  var lang = ctx.lang === 'en' ? 'en' : 'ja';
  var t = UI_STRINGS[lang];
  var suffix = ctx.suffix || '';
  var langRoot = ctx.base + (lang === 'en' ? 'en/' : '');
  var jaAbs = ctx.baseUrl + suffix;
  var enAbs = ctx.baseUrl + 'en/' + suffix;
  var hreflang =
    '<link rel="alternate" hreflang="ja" href="' + esc(jaAbs) + '">' +
    '<link rel="alternate" hreflang="en" href="' + esc(enAbs) + '">' +
    '<link rel="alternate" hreflang="x-default" href="' + esc(jaAbs) + '">';
  var other = lang === 'en' ? 'ja' : 'en';
  var otherUrl = lang === 'en' ? (ctx.base + suffix) : (ctx.base + 'en/' + suffix);
  var langSwitch = '<a class="lang-switch" href="' + esc(otherUrl) + '" hreflang="' + other +
    '" lang="' + other + '">' + esc(t.switchTo) + '</a>';
  var footer =
    '<a href="' + langRoot + 'archive/">' + esc(t.pastEvents) + '</a>' +
    '<a href="' + ctx.base + 'attention.html">' + esc(t.attention) + '</a>' +
    '<a href="' + ctx.base + 'privacy.html">' + esc(t.privacy) + '</a>' +
    '<a href="' + ctx.base + 'tokusho.html">' + esc(t.tokusho) + '</a>';
  var nav = '<a href="' + langRoot + '">CURRENT</a><a href="' + langRoot + 'archive/">ARCHIVE</a>';
  return {
    lang: lang, t: t, langRoot: langRoot, suffix: suffix,
    canonical: lang === 'en' ? enAbs : jaAbs,
    hreflang: hreflang, langSwitch: langSwitch, footer: footer, nav: nav, ogLocale: t.ogLocale
  };
}

/* 画像URLを解決。未登録なら null（＝プレースホルダ表示） */
function assetUrl(ctx, eventId, file) {
  if (!file) return null;
  var key = eventId + '/' + file;
  var hit = ctx.assets && ctx.assets[key];
  return hit ? ctx.base + hit : null;
}

// 画像URLの解決。Google Drive共有URLは表示用サムネイル(w2000)へ、http(s)直リンクはそのまま、
// それ以外はファイル名として自己ホスト(assets/)を参照。※動画と違い画像はDrive表示が可能。
function imgUrl(ctx, eventId, file) {
  var s = String(file || '').trim();
  if (!s) return null;
  var m = s.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/) || s.match(/drive\.google\.com\/[^]*[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w2000';
  if (/^https?:\/\//.test(s)) return s;
  return assetUrl(ctx, eventId, s);
}

function imgTag(ctx, eventId, raw, cls, lazy) {
  var r = parseImageRef(raw);
  var url = imgUrl(ctx, eventId, r.file);
  if (!url) return '';
  return '<img src="' + esc(url) + '" alt="' + esc(r.alt) + '"' +
    (cls ? ' class="' + cls + '"' : '') +
    (lazy === false ? '' : ' loading="lazy" decoding="async"') + '>';
}

/* ---------- イベントの状態判定（Asia/Tokyo 固定、終演時刻まで「開催中」） ---------- */
function eventEndMs(ev) {
  // date: "2026-09-12", close: "05:00"（翌朝なら open より小さい＝翌日扱い）
  var d = String(ev.date || '').split('-');
  if (d.length !== 3) return 0;
  var open = String(ev.open || '00:00').split(':');
  var close = String(ev.close || '23:59').split(':');
  var base = Date.UTC(+d[0], +d[1] - 1, +d[2], 0, 0, 0) - 9 * 3600 * 1000; // JST 00:00
  var closeMin = (+close[0]) * 60 + (+close[1] || 0);
  var openMin = (+open[0]) * 60 + (+open[1] || 0);
  var addDay = closeMin <= openMin ? 1 : 0;
  return base + (addDay * 24 * 60 + closeMin) * 60 * 1000;
}

function isPast(ev, nowMs) {
  return eventEndMs(ev) < nowMs;
}

function jpDate(ev) {
  var d = String(ev.date || '').split('-');
  if (d.length !== 3) return esc(ev.date);
  return d[0] + '.' + d[1] + '.' + d[2];
}

/* ---------- ブロック描画 ---------- */
// 動画URLを <video src> 用に整える。Google Drive共有URLは直接再生用(uc?export=download)へ、
// 直リンク(.mp4/.webm等・自己ホスト)はそのまま。http(s)以外は空（安全）。
function videoSrc(u, base) {
  var s = String(u || '').trim();
  if (!s || /^(javascript|data|vbscript):/i.test(s)) return '';
  if (/^https?:\/\//.test(s)) return s;          // 外部直リンク（mp4等）
  return (base || '') + s.replace(/^\/+/, '');    // サイト内相対パス（videos/xxx.mp4）
}

// Instagram投稿URL → 埋め込みURL。正規の instagram.com/(p|reel|tv)/CODE のみ許可（不正値はiframe化しない）
function igEmbedUrl(u) {
  var m = String(u || '').trim().match(/^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? 'https://www.instagram.com/' + m[1] + '/' + m[2] + '/embed' : '';
}

function renderBlocks(blocks, ev, ctx) {
  var out = [];
  var lang = ctx.lang === 'en' ? 'en' : 'ja';
  var T = UI_STRINGS[lang];
  blocks.forEach(function (b) {
    var type = String(b.type || '').toLowerCase();
    // 招待版（関係者ご招待）では料金表を出さない（購入導線の非表示）
    if (ctx.invite && type === 'table') return;
    var bTitle = loc(b, 'title', lang);
    var bBody = loc(b, 'body', lang);
    // title は「ABOUT|夜だけの、もうひとつの東京」のように 小ラベル|大見出し と書ける
    var head = '', anchor = type;
    if (bTitle) {
      var tp = String(bTitle).split('|');
      var label = tp[0].trim();
      var big = (tp[1] || '').trim();
      anchor = label;
      head = '<span class="eyebrow">' + esc(label) + '</span>' +
        (big ? '<h2 class="sec-title">' + esc(big) + '</h2>' : '');
    }
    var inner = '';

    if (type === 'text') {
      // 任意でフライヤー画像（b.image = "ファイル名|alt"）を横に添えられる
      var copy = '<div class="body-copy">' + lines(bBody).map(function (p) {
        return '<p>' + esc(p) + '</p>';
      }).join('') + '</div>';
      var flyer = b.image ? imgTag(ctx, ev.id, b.image, 'text-flyer') : '';
      inner = flyer
        ? '<div class="text-with-flyer">' + copy + '<div class="text-flyer-wrap">' + flyer + '</div></div>'
        : copy;

    } else if (type === 'image') {
      var tag = imgTag(ctx, ev.id, b.image);
      if (!tag) return;
      inner = '<figure class="figure">' + tag +
        (bBody ? '<figcaption>' + esc(bBody) + '</figcaption>' : '') + '</figure>';

    } else if (type === 'gallery') {
      var items = splitList(b.image).map(function (raw) {
        var r = parseImageRef(raw);
        var url = imgUrl(ctx, ev.id, r.file);
        if (!url) return '';
        return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' +
          '<img src="' + esc(url) + '" alt="' + esc(r.alt) + '" loading="lazy" decoding="async"></a>';
      }).filter(Boolean);
      if (!items.length) return;
      inner = '<div class="gallery">' + items.join('') + '</div>';

    } else if (type === 'lineup') {
      // 1行 = 名前 | 役割 | リンクURL | 画像ファイル名（後半3つは任意）
      // 区切りは | （URLに含まれる / と衝突しないよう news/table と統一）
      // 画像フィールドはファイル名のみ（alt は出演者名を自動採用）
      var anyPhoto = false;
      var arts = lines(bBody).map(function (l) {
        var p = l.split('|').map(function (s) { return s.trim(); });
        var name = esc(p[0] || '');
        var role = esc(p[1] || '');
        var url = (p[2] || '').trim();
        var photoUrl = p[3] ? imgUrl(ctx, ev.id, p[3]) : null;
        var photo = photoUrl
          ? '<span class="artist-photo-wrap"><img class="artist-photo" src="' + esc(photoUrl) + '" alt="' + name + '" loading="lazy" decoding="async"></span>'
          : '';
        if (photo) anyPhoto = true;
        var body = photo +
          '<span class="artist-name">' + name + '</span>' +
          (role ? '<span class="artist-role">' + role + '</span>' : '');
        var cls = 'artist' + (photo ? ' has-photo' : '');
        return url
          ? '<a class="' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + body + '</a>'
          : '<div class="' + cls + '">' + body + '</div>';
      });
      // 出演者が未入力ならセクションごと非表示（素材が入れば自動でカード表示）
      if (!arts.length) return;
      inner = '<div class="lineup' + (anyPhoto ? ' lineup-cards' : '') + '">' + arts.join('') + '</div>';

    } else if (type === 'table') {
      var cards = lines(bBody).map(function (l, i) {
        var p = l.split('|').map(function (s) { return s.trim(); });
        return '<div class="table-card" data-rank="' + (i + 1) + '">' +
          '<div class="table-head"><span class="table-name">' + esc(p[0] || '') + '</span>' +
          '<span class="table-price">' + esc(p[2] || '') + '</span></div>' +
          (p[3] ? '<p class="table-meta">' + esc(p[3]) + '</p>' : '') +
          (p[1] ? '<span class="table-seats">' + esc(p[1]) + '</span>' : '') +
          '</div>';
      });
      if (!cards.length) return;
      inner = '<div class="tables">' + cards.join('') + '</div>';

    } else if (type === 'news') {
      var items2 = lines(bBody).map(function (l) {
        var p = l.split('|').map(function (s) { return s.trim(); });
        return '<div class="news-item">' +
          '<span class="news-date">' + esc(p[0] || '') + '</span>' +
          (p[1] ? '<span class="news-label">' + esc(p[1]) + '</span>' : '') +
          '<span class="news-text">' + esc(p[2] || '') + '</span></div>';
      });
      if (!items2.length) return;
      inner = '<div>' + items2.join('') + '</div>';

    } else if (type === 'access') {
      var q = String(b.link || bBody || '').trim();
      var src = /^https?:\/\//.test(q) ? q
        : 'https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed';
      inner = (bBody ? '<p class="sec-sub">' + esc(bBody) + '</p>' : '') +
        '<iframe class="map" src="' + esc(src) + '" loading="lazy" title="会場の地図" referrerpolicy="no-referrer-when-downgrade"></iframe>';

    } else if (type === 'embed') {
      var u = String(b.link || '').trim();
      var em = '';
      var yt = u.match(/(?:youtu\.be\/|v=)([\w-]{6,})/);
      if (yt) em = 'https://www.youtube.com/embed/' + yt[1];
      else em = igEmbedUrl(u); // 正規のInstagram投稿URLのみ埋め込み
      if (!em) return;
      var isIg = /instagram\.com/.test(em);
      inner = '<div class="embed' + (isIg ? ' embed-ig' : '') + '"><iframe src="' + esc(em) + '" loading="lazy" allowfullscreen scrolling="no" title="' + esc(bTitle || (lang === 'en' ? 'Video' : '動画')) + '"></iframe></div>';

    } else if (type === 'entry') {
      var href = String(b.link || '').trim();
      if (!href) return;
      inner = (bBody ? '<div class="body-copy"><p>' + lines(bBody).join('</p><p>') + '</p></div>' : '') +
        '<div class="hero-cta"><a class="btn btn-fill" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(ctx.invite ? T.entryFree : T.entry) + '</a></div>';

    } else if (type === 'pastevents') {
      // 任意の説明文（bBody）＋過去イベントの写真カード帯を自動生成。
      // コンセプト説明の配下に「どんなイベントか」を実例で並べる用途。各カードは詳細ページへリンク。
      var pes = ctx.pastEvents || [];
      var pgLangRoot = ctx.base + (lang === 'en' ? 'en/' : '');
      var peLead = bBody
        ? '<div class="body-copy">' + lines(bBody).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>'
        : '';
      var peCards = pes.length ? '<div class="pastgrid">' + pes.map(function (pe) {
        var pTtl = esc(String(loc(pe, 'title', lang) || '').split('|').join(' '));
        var cap = '<div class="pastcard-cap">' +
            '<span class="pastcard-date">' + esc(jpDate(pe)) + '</span>' +
            '<span class="pastcard-title">' + pTtl + '</span>' +
          '</div>';
        // 動画(Drive/直リンク)があれば自動再生リール。次にInstagram埋め込み、無ければ写真カード。
        var vsrc = videoSrc(pe.heroVideo || pe.video, ctx.base);
        if (vsrc) {
          return '<div class="pastcard pastcard-reel">' +
            '<div class="reel"><video src="' + esc(vsrc) + '" autoplay muted loop playsinline preload="metadata"></video></div>' +
            cap + '</div>';
        }
        // 動画が無い場合は写真/リンクカード。Instagram投稿があれば外部リンク、無ければ詳細ページ。
        var extLink = (pe.instagram && /^https?:\/\//.test(pe.instagram)) ? pe.instagram : '';
        var pUrl = extLink || (pgLangRoot + 'events/' + pe.id + '/');
        var pImg = imgUrl(ctx, pe.id, parseImageRef(pe.heroImage || '').file);
        return '<a class="pastcard' + (pImg ? '' : ' pastcard-noimg') + '" href="' + esc(pUrl) + '"' + (extLink ? ' target="_blank" rel="noopener"' : '') + '>' +
          '<span class="pastcard-media">' + (pImg ? '<img src="' + esc(pImg) + '" alt="' + pTtl + '" loading="lazy" decoding="async">' : '') + '</span>' +
          cap + '</a>';
      }).join('') + '</div>' : '';
      // b.link があれば「Instagramで詳しく見る」ボタンを末尾に設置
      var peBtn = b.link
        ? '<div class="past-more"><a class="btn btn-line" href="' + esc(b.link) + '" target="_blank" rel="noopener">' + (lang === 'en' ? 'See more on Instagram' : 'Instagramで詳しく見る') + '</a></div>'
        : '';
      if (!peLead && !peCards && !peBtn) return;
      inner = peLead + peCards + peBtn;

    } else if (type === 'prevevent') {
      // 前回（直近の終了）イベントを自動で差し込むカード。ctx.prevEvent が無ければ描画しない。
      var pe = ctx.prevEvent;
      if (!pe) return;
      var peLangRoot = ctx.base + (lang === 'en' ? 'en/' : '');
      var peTitle = esc(String(loc(pe, 'title', lang) || '').split('|').join(' '));
      var peImg = imgUrl(ctx, pe.id, parseImageRef(pe.heroImage || '').file);
      var peLead = esc(loc(pe, 'lead', lang) || '');
      inner = '<a class="prevevent" href="' + esc(peLangRoot + 'events/' + pe.id + '/') + '">' +
        (peImg ? '<span class="prevevent-media"><img src="' + esc(peImg) + '" alt="' + peTitle + '" loading="lazy" decoding="async"></span>' : '') +
        '<span class="prevevent-body">' +
          '<span class="prevevent-date">' + esc(jpDate(pe)) + '</span>' +
          '<span class="prevevent-title">' + peTitle + '</span>' +
          (peLead ? '<span class="prevevent-lead">' + peLead + '</span>' : '') +
          '<span class="prevevent-link">' + esc(T.viewNight) + ' →</span>' +
        '</span></a>';

    } else {
      return; // 未知のtypeは無視（シートの打ち間違いでページが壊れない）
    }

    out.push('<section class="sec reveal" id="' + esc(slugify(anchor)) + '">' + head + inner + '</section>');
  });
  return out.join('\n');
}

/* ---------- イベントページ ---------- */
function renderEventPage(tpl, ev, blocks, ctx) {
  var i = i18n(ctx);
  var t = i.t;
  var past = isPast(ev, ctx.now);
  var heroRef = parseImageRef(ev.heroImage);
  var heroUrl = imgUrl(ctx, ev.id, heroRef.file);
  var ogpUrl = imgUrl(ctx, ev.id, parseImageRef(ev.ogpImage || ev.heroImage).file);

  var title = loc(ev, 'title', i.lang) || ctx.siteName;
  var lead = loc(ev, 'lead', i.lang);
  var h1 = String(title).split('|');
  var h1html = esc(h1[0].trim()) + (h1[1] ? '<span class="l2">' + esc(h1[1].trim()) + '</span>' : '');

  var facts = '';
  if (ev.date) facts += '<div class="fact"><dt>Date</dt><dd>' + jpDate(ev) + ' <small>' + esc(ev.day || '') + '</small></dd></div>';
  if (ev.open) facts += '<div class="fact"><dt>Time</dt><dd>' + esc(ev.open) + '<small> — ' + esc(ev.close || '') + '</small></dd></div>';
  if (ev.venue) facts += '<div class="fact"><dt>Venue</dt><dd>' + esc(loc(ev, 'venue', i.lang)) + '</dd></div>';

  // 招待版は「無料で申し込む / RSVP FREE」ラベル。本編は通常の購入CTA。
  var ctaText = ctx.invite ? t.entryFree : t.entry;

  var heroCta = '';
  if (!past && ev.entryUrl) {
    heroCta = '<a class="btn btn-fill" href="' + esc(ev.entryUrl) + '" target="_blank" rel="noopener">' + esc(ctaText) + '</a>';
  }
  heroCta += '<a class="btn btn-line" href="' + i.langRoot + 'archive/">' + esc(t.pastEvents) + '</a>';

  var headerCta = (!past && ev.entryUrl)
    ? '<a class="cta-mini" href="' + esc(ev.entryUrl) + '" target="_blank" rel="noopener">' + (ctx.invite ? 'RSVP' : 'TICKET') + '</a>'
    : '<a class="cta-mini" href="' + i.langRoot + 'archive/">ARCHIVE</a>';

  // 常時表示のCTAバー（開催予定のときだけ・一般エントリー＋VIP）
  var stickyBtns = '';
  if (!past && ev.entryUrl) stickyBtns += '<a class="scta-btn scta-fill" href="' + esc(ev.entryUrl) + '" target="_blank" rel="noopener">' + esc(ctaText) + '</a>';
  if (!past && ev.vipUrl && !ctx.invite) stickyBtns += '<a class="scta-btn scta-line" href="' + esc(ev.vipUrl) + '" target="_blank" rel="noopener">' + esc(t.vip) + '</a>';
  var stickyCta = stickyBtns
    ? '<div class="sticky-cta"><div class="scta-inner"><span class="scta-title">' + esc(String(title).split('|')[0].trim()) + '</span><span class="scta-btns">' + stickyBtns + '</span></div></div>'
    : '';

  // 構造化データ（Event schema）＝Google検索のリッチ表示（開催予定のみ）
  var ogpFull = ogpUrl ? (/^https?:\/\//.test(ogpUrl) ? ogpUrl : ctx.baseUrl + ogpUrl.replace(/^\.*\//, '')) : '';
  var jsonld = '';
  if (!past) {
    var ld = {
      '@context': 'https://schema.org', '@type': 'Event',
      name: String(title).split('|').join(' '),
      startDate: ev.date + (ev.open ? 'T' + ev.open + ':00+09:00' : ''),
      endDate: ev.date + (ev.close ? 'T' + ev.close + ':00+09:00' : ''),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      description: lead || '',
      organizer: { '@type': 'Organization', name: ctx.siteName, url: ctx.baseUrl }
    };
    if (ev.venue) ld.location = { '@type': 'Place', name: ev.venue, address: { '@type': 'PostalAddress', addressLocality: '東京', addressCountry: 'JP' } };
    if (ogpFull) ld.image = [ogpFull];
    // 招待版は無料・限定公開のため価格オファーを構造化データに出さない
    if (ev.entryUrl && !ctx.invite) ld.offers = { '@type': 'AggregateOffer', lowPrice: '5000', highPrice: '20000', priceCurrency: 'JPY', url: ev.entryUrl, availability: 'https://schema.org/InStock' };
    jsonld = '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
  }

  var map = {
    '{{JSONLD}}': jsonld,
    '{{LANG}}': i.lang,
    '{{OG_LOCALE}}': i.ogLocale,
    '{{HREFLANG}}': i.hreflang,
    '{{LANG_SWITCH}}': i.langSwitch,
    '{{LANG_ROOT}}': i.langRoot,
    '{{TITLE}}': esc(String(title).replace('|', ' ') + (title !== ctx.siteName ? ' | ' + ctx.siteName : '')),
    '{{DESC}}': esc(lead || t.heldAt(jpDate(ev), ev.venue || '')),
    '{{CANONICAL}}': esc(i.canonical),
    '{{ROBOTS}}': ctx.noindex ? '<meta name="robots" content="noindex, nofollow">' : '',
    '{{SITE_NAME}}': esc(ctx.siteName),
    '{{OGP}}': esc(ogpUrl ? (/^https?:\/\//.test(ogpUrl) ? ogpUrl : ctx.baseUrl + ogpUrl.replace(/^\.*\//, '')) : ''),
    '{{BASE}}': ctx.base,
    '{{BRAND_HTML}}': ctx.brandHtml,
    '{{NAV}}': i.nav,
    '{{HEADER_CTA}}': headerCta,
    '{{FOOTER_LINKS}}': i.footer,
    '{{HERO_MEDIA}}': (function () {
      var hv = videoSrc(ev.heroVideo, ctx.base);
      if (hv) return '<div class="hero-media"><video class="hero-vid" src="' + esc(hv) + '" autoplay muted loop playsinline preload="metadata"' + (heroUrl ? ' poster="' + esc(heroUrl) + '"' : '') + '></video></div>';
      return heroUrl ? '<div class="hero-media"><img src="' + esc(heroUrl) + '" alt="' + esc(heroRef.alt) + '" fetchpriority="high" decoding="async"></div>' : '';
    })(),
    '{{ANALYTICS}}': analyticsHtml(ctx),
    '{{ENDED_BADGE}}': past ? '<span class="ended-badge">ENDED</span>' : '',
    '{{INVITE_BADGE}}': ctx.invite ? '<span class="invite-badge">関係者ご招待 <span>/ Invitation</span></span>' : '',
    '{{EDITION}}': esc(ev.edition || ''),
    '{{H1}}': h1html,
    '{{FACTS}}': facts,
    '{{HERO_CTA}}': heroCta,
    '{{BLOCKS}}': renderBlocks(blocks, ev, ctx),
    '{{SNS}}': ctx.snsHtml,
    '{{STICKY_CTA}}': stickyCta
  };
  return fill(tpl, map);
}

/* ---------- アーカイブ（壁） ---------- */
function renderArchivePage(tpl, events, ctx) {
  var i = i18n(ctx);
  var t = i.t;
  var byYear = {};
  events.forEach(function (ev) {
    var y = String(ev.date || '').slice(0, 4) || 'OTHER';
    (byYear[y] = byYear[y] || []).push(ev);
  });
  var years = Object.keys(byYear).sort().reverse();

  var wall = years.map(function (y) {
    var cards = byYear[y].sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    }).map(function (ev) {
      var r = parseImageRef(ev.heroImage);
      var url = imgUrl(ctx, ev.id, r.file);
      var vsrc = videoSrc(ev.heroVideo, ctx.base);
      var media = vsrc
        ? '<video src="' + esc(vsrc) + '" autoplay muted loop playsinline preload="metadata"></video>'
        : url
          ? '<img src="' + esc(url) + '" alt="' + esc(r.alt) + '" loading="lazy" decoding="async">'
          : '<div style="aspect-ratio:3/4;background:linear-gradient(150deg,var(--smoke),var(--ink))"></div>';
      return '<a class="wall-card" href="' + i.langRoot + 'events/' + esc(ev.id) + '/">' + media +
        '<span class="wall-meta"><span class="wall-date">' + jpDate(ev) + '</span>' +
        '<span class="wall-title">' + esc(String(loc(ev, 'title', i.lang) || '').replace('|', ' ')) + '</span></span></a>';
    }).join('');
    return '<h3 class="wall-year">' + esc(y) + '</h3><div class="wall">' + cards + '</div>';
  }).join('');

  var map = {
    '{{LANG}}': i.lang,
    '{{OG_LOCALE}}': i.ogLocale,
    '{{HREFLANG}}': i.hreflang,
    '{{LANG_SWITCH}}': i.langSwitch,
    '{{LANG_ROOT}}': i.langRoot,
    '{{TITLE}}': 'ARCHIVE | ' + esc(ctx.siteName),
    '{{DESC}}': esc(t.archiveDesc),
    '{{CANONICAL}}': esc(i.canonical),
    '{{ROBOTS}}': ctx.noindex ? '<meta name="robots" content="noindex, nofollow">' : '',
    '{{SITE_NAME}}': esc(ctx.siteName),
    '{{OGP}}': esc(ctx.defaultOgp || ''),
    '{{BASE}}': ctx.base,
    '{{BRAND_HTML}}': ctx.brandHtml,
    '{{NAV}}': i.nav,
    '{{HEADER_CTA}}': '<a class="cta-mini" href="' + i.langRoot + '">' + esc(t.currentEvent) + '</a>',
    '{{FOOTER_LINKS}}': i.footer,
    '{{ANALYTICS}}': analyticsHtml(ctx),
    '{{ARCHIVE_EYEBROW}}': esc(t.archiveEyebrow),
    '{{ARCHIVE_TITLE}}': t.archiveTitle,
    '{{ARCHIVE_SUB}}': esc(t.archiveSub(events.length)),
    '{{COUNT}}': String(events.length),
    '{{WALL}}': wall || '<p class="sec-sub">' + esc(t.archiveEmpty) + '</p>',
    '{{SNS}}': ctx.snsHtml
  };
  return fill(tpl, map);
}

function fill(tpl, map) {
  var out = tpl;
  Object.keys(map).forEach(function (k) {
    out = out.split(k).join(map[k]);
  });
  return out;
}

function snsHtml(sns) {
  return Object.keys(sns || {}).filter(function (k) { return sns[k]; }).map(function (k) {
    return '<a href="' + esc(sns[k]) + '" target="_blank" rel="noopener">' + esc(k.toUpperCase()) + '</a>';
  }).join('');
}

/* ---------- 解析タグ（config で ID を渡すと head に挿入。preview では出さない） ---------- */
/* GA4測定ID（G-XXXX）と MetaピクセルID を config 化。ID未設定なら何も出力しない。 */
function analyticsHtml(ctx) {
  if (ctx.noindex) return '';                 // preview は計測しない（本番データを汚さない）
  var out = '';
  var ga4 = ctx.ga4Id;
  if (ga4 && /^[\w-]+$/.test(ga4)) {
    out += '<script async src="https://www.googletagmanager.com/gtag/js?id=' + esc(ga4) + '"></script>' +
      '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}' +
      "gtag('js',new Date());gtag('config','" + esc(ga4) + "');</script>";
  }
  var px = ctx.metaPixelId;
  if (px && /^\d+$/.test(px)) {
    out += '<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?' +
      'n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;' +
      'n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;' +
      't.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}' +
      '(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");' +
      "fbq('init','" + esc(px) + "');fbq('track','PageView');</script>" +
      '<noscript><img height="1" width="1" style="display:none" ' +
      'src="https://www.facebook.com/tr?id=' + esc(px) + '&ev=PageView&noscript=1"></noscript>';
  }
  return out;
}

/* baseUrl のパス部分（絶対パス基点）。"https://x.github.io/luxe-site/" -> "/luxe-site/" */
function absBasePath(baseUrl) {
  return String(baseUrl || '/').replace(/^https?:\/\/[^\/]+/, '') || '/';
}

/* ---------- 404（GitHub Pages はどの深さでも /404.html を返すため絶対パスで組む） ---------- */
function render404Page(tpl, ctx) {
  var i = i18n(ctx);
  var t = i.t;
  var ab = absBasePath(ctx.baseUrl);
  var map = {
    '{{LANG}}': 'ja',
    '{{OG_LOCALE}}': 'ja_JP',
    '{{HREFLANG}}': '',
    '{{LANG_SWITCH}}': '',
    '{{LANG_ROOT}}': ab,
    '{{TITLE}}': '404 | ' + esc(ctx.siteName),
    '{{DESC}}': '',
    '{{CANONICAL}}': '',
    '{{ROBOTS}}': '<meta name="robots" content="noindex, follow">',
    '{{SITE_NAME}}': esc(ctx.siteName),
    '{{OGP}}': '',
    '{{BASE}}': ab,
    '{{BRAND_HTML}}': ctx.brandHtml,
    '{{ANALYTICS}}': '',
    '{{HOME_URL}}': ab,
    '{{SNS}}': ctx.snsHtml
  };
  return fill(tpl, map);
}

/* ---------- sitemap.xml（ja/en を hreflang 相互リンク付きで列挙） ---------- */
/* suffixes: 言語ルート以下のパス配列（'' / 'events/<id>/' / 'archive/'）。preview では生成しない。 */
function renderSitemap(suffixes, cfg) {
  var base = cfg.baseUrl;
  var urls = [];
  suffixes.forEach(function (suffix) {
    var jaAbs = base + suffix;
    var enAbs = base + 'en/' + suffix;
    var alts =
      '<xhtml:link rel="alternate" hreflang="ja" href="' + esc(jaAbs) + '"/>' +
      '<xhtml:link rel="alternate" hreflang="en" href="' + esc(enAbs) + '"/>' +
      '<xhtml:link rel="alternate" hreflang="x-default" href="' + esc(jaAbs) + '"/>';
    urls.push('<url><loc>' + esc(jaAbs) + '</loc>' + alts + '</url>');
    urls.push('<url><loc>' + esc(enAbs) + '</loc>' + alts + '</url>');
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + urls.join('\n') + '\n</urlset>\n';
}

/* ---------- robots.txt ---------- */
function renderRobots(cfg) {
  // /invite/・/en/invite/ は関係者向け限定公開のためクロール拒否（sitemapにも載せない）
  // /invite/・/p/ は限定配布（本編と内容が重複するため、検索に出すと公開サイト側のSEOを食い合う）
  return 'User-agent: *\nAllow: /\nDisallow: /preview/\nDisallow: /invite/\nDisallow: /en/invite/\nDisallow: /p/\nDisallow: /en/p/\n\nSitemap: ' + cfg.baseUrl + 'sitemap.xml\n';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc: esc, slugify: slugify, parseImageRef: parseImageRef, isPast: isPast,
    eventEndMs: eventEndMs, renderBlocks: renderBlocks, renderEventPage: renderEventPage,
    renderArchivePage: renderArchivePage, snsHtml: snsHtml,
    render404Page: render404Page, renderSitemap: renderSitemap, renderRobots: renderRobots,
    analyticsHtml: analyticsHtml, absBasePath: absBasePath
  };
}
