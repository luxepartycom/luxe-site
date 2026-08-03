/* =========================================================================
   Code.gs — スプレッドシート＋Drive から静的サイトを生成し GitHub へ反映する
   ・render.gs（_shared/render.js と同じ内容）を同じプロジェクトに入れてください
   ・スクリプトプロパティに GITHUB_TOKEN を設定してください（fine-grained PAT / Contents: Read and write）
   ========================================================================= */

var P = PropertiesService.getScriptProperties();

/* ---------------- メニュー ---------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('サイト')
    .addItem('サイトを更新（公開）', 'publish')
    .addItem('プレビューを更新（noindex）', 'publishPreview')
    .addSeparator()
    .addItem('シートのひな形を作る', 'setupSheets')
    .addItem('設定を確認する', 'checkConfig')
    .addToUi();
}

/* ---------------- 公開 ---------------- */
function publish() { run_(false); }
function publishPreview() { run_(true); }

function run_(isPreview) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { alert_('別の更新が実行中です。1分ほど待って再度お試しください。'); return; }
  var t0 = Date.now();
  try {
    var cfg = readConfig_();
    var events = readEvents_();
    var blocks = readBlocks_();

    var errors = validate_(cfg, events, blocks);
    if (errors.length) {
      log_('NG', errors.join(' / '), 0);
      alert_('公開を中止しました。\n\n' + errors.join('\n'));
      return;
    }

    var now = Date.now();
    var pub = events.filter(function (e) { return e.published !== false; });
    var upcoming = pub.filter(function (e) { return !isPast(e, now); })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var past = pub.filter(function (e) { return isPast(e, now); });
    var current = upcoming[0] || past.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    })[0];
    if (!current) { alert_('公開できるイベントがありません。'); return; }

    /* --- 画像：Drive → 差分だけ GitHub へ --- */
    var manifest = ghReadJson_(cfg, 'data/manifest.json') || {};
    var imgResult = collectImages_(cfg, pub, blocks, manifest);

    /* --- HTML 生成 --- */
    var tplEvent = ghReadText_(cfg, '_templates/event.html');
    var tplArchive = ghReadText_(cfg, '_templates/archive.html');
    var tpl404 = ghReadText_(cfg, '_templates/404.html');
    var brandHtml = esc(cfg.brandLine1) + ' <span>' + esc(cfg.brandAccent) + '</span> ' + esc(cfg.brandLine2);
    var sns = snsHtml(cfg.sns);

    function ctx(base, suffix, lang) {
      return {
        base: base, suffix: suffix, lang: lang, now: now, assets: imgResult.assets,
        siteName: cfg.siteName, baseUrl: cfg.baseUrl,
        brandHtml: brandHtml, snsHtml: sns, noindex: isPreview,
        ga4Id: cfg.ga4Id, metaPixelId: cfg.metaPixelId
      };
    }
    function blocksFor(id) {
      return blocks.filter(function (b) { return b.eventId === id && b.published !== false; })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    }

    var prefix = isPreview ? 'preview/' : '';
    // base はサイトルート相対。preview は全体が1階層深いので '../' を足す。
    // en ページは ja 相当よりさらに1階層深いので、その base に '../' を足す。
    var pv = isPreview ? '../' : '';
    var langs = [
      { lang: 'ja', dir: '', bIndex: pv, bEvent: pv + '../../', bArchive: pv + '../' },
      { lang: 'en', dir: 'en/', bIndex: pv + '../', bEvent: pv + '../../../', bArchive: pv + '../../' }
    ];
    var files = [];
    langs.forEach(function (L) {
      files.push({
        path: prefix + L.dir + 'index.html',
        text: renderEventPage(tplEvent, current, blocksFor(current.id), ctx(L.bIndex, '', L.lang))
      });
      pub.forEach(function (ev) {
        files.push({
          path: prefix + L.dir + 'events/' + ev.id + '/index.html',
          text: renderEventPage(tplEvent, ev, blocksFor(ev.id), ctx(L.bEvent, 'events/' + ev.id + '/', L.lang))
        });
      });
      files.push({
        path: prefix + L.dir + 'archive/index.html',
        text: renderArchivePage(tplArchive, past, ctx(L.bArchive, 'archive/', L.lang))
      });
    });

    if (!isPreview) {
      files.push({ path: 'data/site.json', text: JSON.stringify({ generatedAt: new Date().toISOString(), config: cfg, events: pub, blocks: blocks, assets: imgResult.assets }, null, 2) });
      files.push({ path: 'data/manifest.json', text: JSON.stringify(imgResult.manifest, null, 2) });

      // 404・sitemap・robots（本番のみ。sitemap は ja/en 両方を hreflang 付きで列挙）
      files.push({ path: '404.html', text: render404Page(tpl404, ctx('', '', 'ja')) });
      var suffixes = [''].concat(pub.map(function (ev) { return 'events/' + ev.id + '/'; })).concat(['archive/']);
      files.push({ path: 'sitemap.xml', text: renderSitemap(suffixes, cfg) });
      files.push({ path: 'robots.txt', text: renderRobots(cfg) });
    }

    /* --- 1コミットでまとめて反映（途中で失敗しても中途半端に公開されない） --- */
    var msg = (isPreview ? 'preview: ' : 'publish: ') + current.id + ' (' + files.length + ' pages, ' +
      imgResult.uploaded.length + ' images)';
    ghCommit_(cfg, files.concat(imgResult.uploaded), msg);

    var sec = Math.round((Date.now() - t0) / 1000);
    log_('OK', msg, sec);
    alert_('更新しました（' + sec + '秒）。\n\n' +
      'ページ: ' + files.length + ' / 画像: ' + imgResult.uploaded.length + ' 件\n' +
      'サイトへの反映まで1〜2分かかります。\n\n' + cfg.baseUrl + prefix);

  } catch (err) {
    log_('ERROR', String(err && err.stack || err), Math.round((Date.now() - t0) / 1000));
    notifyFailure_(err);
    alert_('更新に失敗しました。\n\n' + err);
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- シート読み取り ---------------- */
function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません。メニューの「シートのひな形を作る」を実行してください。');
  return sh;
}
function rows_(name) {
  var v = sheet_(name).getDataRange().getValues();
  if (v.length < 2) return [];
  var head = v[0].map(function (h) { return String(h).trim(); });
  return v.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = r[i]; });
    return o;
  }).filter(function (o) {
    return Object.keys(o).some(function (k) { return String(o[k]).trim() !== ''; });
  });
}
function bool_(v) { return !(v === false || v === 'FALSE' || v === '' || v === 0 || v === 'いいえ'); }
function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}
function time_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'HH:mm');
  return String(v == null ? '' : v).trim();
}

function readConfig_() {
  var o = {};
  rows_('config').forEach(function (r) { o[str_(r['キー'])] = str_(r['値']); });
  return {
    siteName: o.siteName, baseUrl: o.baseUrl.replace(/\/?$/, '/'),
    brandLine1: o.brandLine1, brandAccent: o.brandAccent, brandLine2: o.brandLine2,
    repoOwner: o.repoOwner, repoName: o.repoName, branch: o.branch || 'main',
    driveFolderId: o.driveFolderId,
    imageMode: o.imageMode || 'thumbnail',       // thumbnail（Google側で縮小）| original
    imageWidth: parseInt(o.imageWidth || '1600', 10),
    ga4Id: o.ga4Id || '', metaPixelId: o.metaPixelId || '',   // 解析タグ（空なら埋め込まない）
    notifyEmail: o.notifyEmail || Session.getEffectiveUser().getEmail(),
    sns: { instagram: o.instagram, x: o.x, tiktok: o.tiktok, line: o.line, youtube: o.youtube }
  };
}
function readEvents_() {
  return rows_('events').map(function (r) {
    return {
      id: str_(r['id']), title: str_(r['title']), title_en: str_(r['title_en']), edition: str_(r['edition']),
      date: str_(r['date']), day: str_(r['day']), open: time_(r['open']), close: time_(r['close']),
      venue: str_(r['venue']), heroImage: str_(r['heroImage']), ogpImage: str_(r['ogpImage']),
      lead: str_(r['lead']), lead_en: str_(r['lead_en']), entryUrl: str_(r['entryUrl']), published: bool_(r['published'])
    };
  });
}
function readBlocks_() {
  return rows_('blocks').map(function (r) {
    return {
      eventId: str_(r['eventId']), order: Number(r['order'] || 0), type: str_(r['type']),
      title: str_(r['title']), title_en: str_(r['title_en']),
      body: String(r['body'] == null ? '' : r['body']), body_en: String(r['body_en'] == null ? '' : r['body_en']),
      image: str_(r['image']), link: str_(r['link']), published: bool_(r['published'])
    };
  });
}

/* ---------------- 検証（公開前に止める） ---------------- */
function validate_(cfg, events, blocks) {
  var e = [];
  ['siteName', 'baseUrl', 'repoOwner', 'repoName', 'driveFolderId'].forEach(function (k) {
    if (!cfg[k]) e.push('config の ' + k + ' が空です。');
  });
  if (!P.getProperty('GITHUB_TOKEN')) e.push('スクリプトプロパティ GITHUB_TOKEN が未設定です。');

  var seen = {};
  events.forEach(function (ev, i) {
    var row = i + 2;
    if (!ev.id) { e.push('events ' + row + '行目: id が空です。'); return; }
    if (!/^[a-z0-9\-]+$/.test(ev.id)) e.push('events ' + row + '行目: id は半角英数字とハイフンのみにしてください（' + ev.id + '）。');
    if (seen[ev.id]) e.push('events: id が重複しています（' + ev.id + '）。');
    seen[ev.id] = 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) e.push('events ' + row + '行目: date は 2026-09-12 の形式にしてください（' + ev.date + '）。');
    if (!ev.title) e.push('events ' + row + '行目: title が空です。');
  });
  blocks.forEach(function (b, i) {
    if (b.eventId && !seen[b.eventId]) e.push('blocks ' + (i + 2) + '行目: events に存在しない eventId です（' + b.eventId + '）。');
  });
  return e;
}

/* ---------------- 画像収集（Drive → 差分だけアップ） ---------------- */
function collectImages_(cfg, events, blocks, manifest) {
  var assets = {}, uploaded = [], next = {};
  var root = DriveApp.getFolderById(cfg.driveFolderId);

  events.forEach(function (ev) {
    var want = {};
    [ev.heroImage, ev.ogpImage].forEach(function (r) { var f = parseImageRef(r).file; if (f) want[f] = 1; });
    blocks.filter(function (b) { return b.eventId === ev.id && b.published !== false; })
      .forEach(function (b) {
        String(b.image || '').split(/[,\n]/).forEach(function (raw) {
          var f = parseImageRef(raw).file; if (f) want[f] = 1;
        });
      });
    var names = Object.keys(want);
    if (!names.length) return;

    var folders = root.getFoldersByName(ev.id);
    if (!folders.hasNext()) { return; } // フォルダ未作成でも落とさない（画像は出ない）
    var folder = folders.next();

    names.forEach(function (name) {
      var it = folder.getFilesByName(name);
      if (!it.hasNext()) return;
      var file = it.next();
      var key = ev.id + '/' + name;
      var stamp = file.getId() + ':' + file.getLastUpdated().getTime() + ':' + cfg.imageMode + ':' + cfg.imageWidth;

      if (manifest[key] && manifest[key].stamp === stamp) {   // 変更なし → 再アップしない
        assets[key] = manifest[key].path;
        next[key] = manifest[key];
        return;
      }

      var blob = fetchImageBlob_(file, cfg);
      var bytes = blob.getBytes();
      var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, bytes)
        .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('').slice(0, 8);
      var ext = (cfg.imageMode === 'thumbnail') ? '.jpg' : ('.' + (name.split('.').pop() || 'jpg').toLowerCase());
      var base = slugify(name.replace(/\.[^.]+$/, ''));
      var out = 'assets/' + ev.id + '/' + base + '.' + hash + ext;

      assets[key] = out;
      next[key] = { stamp: stamp, path: out };
      uploaded.push({ path: out, bytes: bytes });
    });
  });

  return { assets: assets, manifest: next, uploaded: uploaded };
}

/* thumbnail モードなら Google 側で縮小済みのJPEGを取得（EXIF回転も適用済み） */
function fetchImageBlob_(file, cfg) {
  if (cfg.imageMode === 'thumbnail') {
    try {
      var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w' + cfg.imageWidth;
      var res = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true, followRedirects: true
      });
      if (res.getResponseCode() === 200 && /^image\//.test(res.getHeaders()['Content-Type'] || '')) {
        return res.getBlob();
      }
    } catch (e) { /* 落ちたら原本にフォールバック */ }
  }
  return file.getBlob();
}

/* ---------------- GitHub ---------------- */
function gh_(cfg, path, method, payload) {
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.repoOwner + '/' + cfg.repoName + path, {
    method: method || 'get',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + P.getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' },
    payload: payload ? JSON.stringify(payload) : null,
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 400) throw new Error('GitHub ' + code + ' ' + path + ' :: ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}
function ghReadText_(cfg, path) {
  var j = gh_(cfg, '/contents/' + encodeURI(path) + '?ref=' + cfg.branch);
  return Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
}
function ghReadJson_(cfg, path) {
  try { return JSON.parse(ghReadText_(cfg, path)); } catch (e) { return null; }
}

/* Git Data API で1コミットにまとめる（原子的に反映） */
function ghCommit_(cfg, files, message) {
  if (!files.length) return;
  var ref = gh_(cfg, '/git/ref/heads/' + cfg.branch);
  var baseSha = ref.object.sha;
  var baseCommit = gh_(cfg, '/git/commits/' + baseSha);

  var tree = files.map(function (f) {
    var blob = f.bytes
      ? gh_(cfg, '/git/blobs', 'post', { content: Utilities.base64Encode(f.bytes), encoding: 'base64' })
      : gh_(cfg, '/git/blobs', 'post', { content: f.text, encoding: 'utf-8' });
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
  });

  var newTree = gh_(cfg, '/git/trees', 'post', { base_tree: baseCommit.tree.sha, tree: tree });
  var commit = gh_(cfg, '/git/commits', 'post', { message: message, tree: newTree.sha, parents: [baseSha] });
  gh_(cfg, '/git/refs/heads/' + cfg.branch, 'patch', { sha: commit.sha });
}

/* ---------------- ログ・通知 ---------------- */
function log_(status, message, sec) {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName('ログ');
    if (!sh) return;
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 4).setValues([[new Date(), status, message, sec + '秒']]);
  } catch (e) { }
}
function notifyFailure_(err) {
  try {
    var cfg = readConfig_();
    MailApp.sendEmail(cfg.notifyEmail, '[サイト更新] 失敗しました',
      'サイトの更新に失敗しました。\n\n' + String(err && err.stack || err) + '\n\nスプレッドシートの「ログ」タブもご確認ください。');
  } catch (e) { }
}
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

/* ---------------- 初期セットアップ ---------------- */
function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  function ensure(name, header, widths) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, header.length).setValues([header])
        .setFontWeight('bold').setBackground('#171029').setFontColor('#E9DDC9');
      sh.setFrozenRows(1);
      (widths || []).forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    }
    return sh;
  }
  var c = ensure('config', ['キー', '値'], [180, 460]);
  if (c.getLastRow() === 1) {
    c.getRange(2, 1, 17, 2).setValues([
      ['siteName', 'LUXE PARTY TOKYO'], ['baseUrl', 'https://ユーザー名.github.io/リポジトリ名/'],
      ['brandLine1', 'LUXE'], ['brandAccent', 'PARTY'], ['brandLine2', 'TOKYO'],
      ['repoOwner', 'GitHubのユーザー名'], ['repoName', 'リポジトリ名'], ['branch', 'main'],
      ['driveFolderId', 'Driveの親フォルダID'], ['imageMode', 'thumbnail'], ['imageWidth', '1600'],
      ['ga4Id', ''], ['metaPixelId', ''],
      ['instagram', ''], ['x', ''], ['tiktok', ''], ['line', '']
    ]);
  }
  ensure('events', ['id', 'title', 'title_en', 'edition', 'date', 'day', 'open', 'close', 'venue',
    'heroImage', 'ogpImage', 'lead', 'lead_en', 'entryUrl', 'published'],
    [190, 190, 190, 200, 100, 60, 70, 70, 110, 200, 160, 300, 300, 220, 90]);
  ensure('blocks', ['eventId', 'order', 'type', 'title', 'title_en', 'body', 'body_en', 'image', 'link', 'published'],
    [190, 60, 110, 160, 160, 420, 420, 260, 260, 90]);
  ensure('ログ', ['日時', '結果', '内容', '所要'], [160, 70, 620, 70]);
  alert_('シートを用意しました。config タブを埋めてから「サイトを更新」を押してください。');
}

function checkConfig() {
  try {
    var cfg = readConfig_();
    var errors = validate_(cfg, readEvents_(), readBlocks_());
    if (errors.length) { alert_('未解決の問題:\n\n' + errors.join('\n')); return; }
    gh_(cfg, '/git/ref/heads/' + cfg.branch);
    DriveApp.getFolderById(cfg.driveFolderId).getName();
    alert_('設定OK。GitHub と Drive の両方に接続できました。');
  } catch (e) { alert_('設定に問題があります:\n\n' + e); }
}
