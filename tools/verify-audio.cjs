// 検証ハーネス（jsdom）: 動画音声「同時再生は常に1つだけ」不変条件を実HTMLで検証。
// 実行: NODE_PATH=~/.cache/claude-node/node_modules node tools/verify-audio.cjs
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const jsErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => jsErrors.push(e.message + (e.detail ? ' | ' + String(e.detail).slice(0,160) : '')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  url: 'https://luxepartycom.github.io/luxe-site/',
  beforeParse(window){
    // jsdom は play()/pause() 未実装なのでモック（本番ブラウザでは実動）
    window.HTMLMediaElement.prototype.play = function(){ this.paused = false; return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function(){ this.paused = true; };
  }
});

setTimeout(() => {
  const w = dom.window;
  let pass = 0, fail = 0;
  const A = (n, c) => { if (c) { pass++; console.log('✅ ' + n); } else { fail++; console.log('❌ ' + n); } };

  A('実HTMLのJSエラー ゼロ', jsErrors.length === 0);
  jsErrors.forEach(e => console.log('   ⚠ ' + e));

  const vids = Array.from(w.document.querySelectorAll('video'));
  A('動画が存在する', vids.length > 0);
  A('__luxeAudio フック定義', !!(w.__luxeAudio && typeof w.__luxeAudio.set === 'function'));
  // 初期ミュートはHTMLの muted 属性で保証（jsdomは属性→v.mutedプロパティを同期しないため属性で検証）
  A('初期状態: 全動画にmuted属性（無音の自動再生のみ）', vids.every(v => v.hasAttribute('muted')));

  const unmutedCount = () => vids.filter(v => v.muted === false).length;

  if (w.__luxeAudio && vids.length >= 2) {
    w.__luxeAudio.set(vids[0]);
    A('setAudio(v0): v0だけ非ミュート', vids[0].muted === false && vids.slice(1).every(v => v.muted !== false));
    A('単一音声の不変条件: 非ミュートは常に1つ', unmutedCount() === 1);

    w.__luxeAudio.set(vids[1]);
    A('切替 setAudio(v1): v1が鳴りv0は自動ミュート（同時再生なし）', vids[1].muted === false && vids[0].muted !== false);
    A('切替後も 非ミュートは1つだけ', unmutedCount() === 1);

    w.__luxeAudio.muteAll();
    A('muteAll: 全て停止（非ミュート0）', unmutedCount() === 0);
  } else if (vids.length === 1 && w.__luxeAudio) {
    w.__luxeAudio.set(vids[0]);
    A('setAudio(v0): 単一動画が鳴る', vids[0].muted === false && unmutedCount() === 1);
    w.__luxeAudio.muteAll();
    A('muteAll: 停止', unmutedCount() === 0);
  }

  // ヒーロー音声ボタンが生成されているか
  A('ヒーロー音声ボタン(.vid-sound)を生成', !!w.document.querySelector('.vid-sound'));

  console.log('\n=== 動画音声ハーネス: ' + pass + ' 合格 / ' + fail + ' 不合格 ===');
  process.exit(fail === 0 ? 0 : 1);
}, 600);
