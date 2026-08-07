#!/usr/bin/env node
/* 検証: /p/index.html の実行時プロモーター固定（?n=<名前>）。
   ブラウザ相当(jsdom)で実際にスクリプトを走らせ、リンクが書き換わるかを見る。
   実行: NODE_PATH=~/.cache/claude-node/node_modules node tools/verify-promoter-runtime.js

   守りたい不変条件:
   - ?n= を付けると、申込システム(entry.luxepartytokyo.com)へのリンク全てに promoter が付く
   - VIPリンクにも付く（LINEではなく vip-plan.html へ行くこと）
   - ?n= が無ければ通常サイトとして振る舞う（素のリンクのまま・壊れない）
   - サイト内リンクは名前を引き継ぐ（回遊で帰属が切れない）
   - 二重付与しない
   - 名前に記号が入ってもURLとして壊れない */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const A = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'p/index.html'), 'utf8');

function open(search) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://luxepartycom.github.io/luxe-site/p/' + search
  });
  return dom;
}
const entryLinks = doc => [...doc.querySelectorAll('a[href^="https://entry.luxepartytokyo.com/"]')].map(a => a.getAttribute('href'));
const innerLinks = doc => [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => !/^https?:|^#/.test(h));

console.log('\n── ?n= 指定あり ─────────────────────────────');
{
  const NAME = '山田太郎';
  const dom = open('?n=' + encodeURIComponent(NAME));
  const doc = dom.window.document;
  const es = entryLinks(doc);
  A('申込リンクが存在する', es.length > 0);
  A('全ての申込リンクに promoter が付く', es.every(h => h.includes('promoter=' + encodeURIComponent(NAME))));
  const vip = es.filter(h => h.includes('vip-plan.html'));
  A('VIPリンクがある（LINEではない）', vip.length > 0);
  A('VIPにも promoter が付く', vip.every(h => h.includes('promoter=')));
  A('VIPのイベントIDが EV-… である', vip.every(h => /[?&]e=EV-[A-Z0-9]+/.test(h)));
  const entry = es.filter(h => h.includes('index.html?e='));
  A('入場チケットは有料(type=paid)のまま', entry.every(h => h.includes('type=paid')));
  A('サイト内リンクが名前を引き継ぐ', innerLinks(doc).every(h => h.includes('n=')));
  A('promoter が二重に付いていない', es.every(h => (h.match(/promoter=/g) || []).length === 1));
  console.log('     例: ' + decodeURIComponent(es.find(h => h.includes('vip-plan')) || ''));
  dom.window.close();
}

console.log('\n── ?n= 無し（通常アクセス）───────────────────');
{
  const dom = open('');
  const doc = dom.window.document;
  const es = entryLinks(doc);
  A('ページは壊れない（リンクが出る）', es.length > 0);
  A('promoter は付かない', es.every(h => !h.includes('promoter=')));
  A('サイト内リンクも素のまま', innerLinks(doc).every(h => !h.includes('n=')));
  dom.window.close();
}

console.log('\n── 別名パラメータ・記号入りの名前 ───────────────');
{
  const dom = open('?p=' + encodeURIComponent('LUXE_Ryu'));
  A('?p= でも受け付ける', entryLinks(dom.window.document).every(h => h.includes('promoter=LUXE_Ryu')));
  dom.window.close();
}
{
  const NAME = 'A&B 太郎';
  const dom = open('?n=' + encodeURIComponent(NAME));
  const es = entryLinks(dom.window.document);
  A('記号(&)入りでもURLが壊れない', es.every(h => h.includes('promoter=' + encodeURIComponent(NAME))));
  A('& がパラメータ区切りとして誤解釈されない', es.every(h => !/promoter=A&B/.test(h)));
  // 実際にURLとして解釈し直して、元の名前が復元できるか
  const u = new URL(es[0]);
  A('URL解析で元の名前に戻る', u.searchParams.get('promoter') === NAME);
  dom.window.close();
}

console.log('\n── 回遊（サイト内リンク経由での保持）─────────────');
{
  // 1度 ?n= 付きで開いた後、パラメータ無しで開いても保持されるか（同一オリジンの保存領域）
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', url: 'https://luxepartycom.github.io/luxe-site/p/?n=' + encodeURIComponent('保持太郎') });
  const store = dom.window.sessionStorage.getItem('luxe_promoter');
  A('名前が保持領域に入る', store === '保持太郎');
  dom.window.close();
}


console.log("\n── VIP支払方法の固定（?pay=）─────────────────");
{
  const dom = open("?n=" + encodeURIComponent("山田太郎"));
  const vip = entryLinks(dom.window.document).filter(h => h.includes("vip-plan.html"));
  A("既定で銀行振込に固定される(pay=transfer)", vip.length > 0 && vip.every(h => /[?&]pay=transfer/.test(h)));
  A("promoter も同時に付く", vip.every(h => h.includes("promoter=")));
  dom.window.close();
}
{
  const dom = open("?n=" + encodeURIComponent("山田太郎") + "&pay=stripe");
  const vip = entryLinks(dom.window.document).filter(h => h.includes("vip-plan.html"));
  A("URLでカード決済へ上書きできる", vip.every(h => /[?&]pay=stripe/.test(h)));
  A("pay が二重に付かない", vip.every(h => (h.match(/pay=/g) || []).length === 1));
  const entry = entryLinks(dom.window.document).filter(h => h.includes("index.html?e="));
  A("入場チケット側に pay は付けない", entry.every(h => !/[?&]pay=/.test(h)));
  dom.window.close();
}
{
  const dom = open("?n=" + encodeURIComponent("山田太郎") + "&pay=abc");
  const vip = entryLinks(dom.window.document).filter(h => h.includes("vip-plan.html"));
  A("不正な値は無視して既定のまま", vip.every(h => /[?&]pay=transfer/.test(h)));
  dom.window.close();
}


{
  const dom = open("?n=" + encodeURIComponent("山田太郎") + "&pay=both");
  const vip = entryLinks(dom.window.document).filter(h => h.includes("vip-plan.html"));
  A("pay=both で支払方法の指定が消える（両方表示）", vip.length > 0 && vip.every(h => !/[?&]pay=/.test(h)));
  A("pay=both でも promoter は残る", vip.every(h => h.includes("promoter=")));
  A("pay=both でURLが壊れない", vip.every(h => { try { new URL(h); return /[?&]e=EV-/.test(h); } catch(e){ return false; } }));
  dom.window.close();
}
{
  const dom = open("?n=" + encodeURIComponent("山田太郎") + "&pay=BOTH");
  const vip = entryLinks(dom.window.document).filter(h => h.includes("vip-plan.html"));
  A("大文字BOTHでも効く", vip.every(h => !/[?&]pay=/.test(h)));
  dom.window.close();
}
{
  const dom = open("?pay=both");
  const vip = entryLinks(dom.window.document).filter(h => h.includes("vip-plan.html"));
  A("名前なし pay=both 単独でも効く", vip.every(h => !/[?&]pay=/.test(h)));
  dom.window.close();
}

console.log('\n' + (fail === 0 ? `—— 全合格 ✅（${pass}件）——` : `—— 不合格 ${fail}件 / 合格 ${pass}件 ❌ ——`));
process.exit(fail === 0 ? 0 : 1);
