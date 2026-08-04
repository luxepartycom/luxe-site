# LUXE-SITE — LUXE PARTY TOKYO 公式サイト 記憶

最終更新：2026-07-27（プロジェクト引き継ぎ・初期化）
プロジェクトタグ：`LUXE-SITE`
事業：event-operations（イベント運営／LPT）

## プロジェクト概要
ナイトイベント「LUXE PARTY TOKYO」の公式静的サイト。
- **入力**：Googleスプレッドシート（文章・日付・価格）＋ Googleドライブ（イベント別フォルダに画像）
- **ビルダー**：GAS（Apps Script）— シート読取→検証→Drive画像取得→GitHubへ1コミット反映
- **配信**：GitHub Pages（静的・無料）
- **設計上の縛り**：ビルドツール・サーバー・課金サービスを一切使わない
- 開催予定イベントがトップ、終演時刻を過ぎたら自動アーカイブ

## 環境分類
**分類A相当（ユーザー向け公開URLあり）** だが、staging機能は本体に内蔵：
- 「サイト → プレビューを更新」で `/preview/`（検索避け付き）へ出力＝本番を書き換えずに確認可能
- ローカル検証は `node tools/build-local.js`（GASと同一の render.js を使用）

## ファイルマップ（リポジトリ内：この階層）
```
_shared/render.js        ★生成ロジックの唯一の実体（Node/GAS両対応の純粋関数）
gas/Code.gs              Apps Script本体（GAS側は render.gs に render.js を同内容で貼る）
_templates/event.html    イベントページ骨格（{{PLACEHOLDER}}方式）
_templates/archive.html  アーカイブ骨格
assets/site.css          共通CSS（色・字送りは :root）
assets/<eventId>/*.jpg   GAS生成画像（コンテンツハッシュ付きファイル名）
tools/build-local.js     ローカル生成（検証用＋GAS障害時の非常口）
sample/sheet-sample.json テストデータ
data/site.json           生成物＝全データのバックアップ（非常口）
data/manifest.json       画像差分判定用（GAS管理・手で触らない）
index.html / archive/ / events/<id>/  生成物（手で編集しない・更新で上書き）
attention.html / privacy.html / tokusho.html  法務ページ（手で編集する・雛形状態）
```

## 現状（2026-07-27時点）
### 完成
- 静的サイト生成の全ロジック（render.js）／GAS本体（Code.gs）
- テンプレート2種・共通CSS・法務3ページ（内容は雛形）
- サンプルデータ3イベント＋ダミー画像でブラウザ動作確認可
- 日本語・単一言語・ローカル検証済み

### 引き継ぎ時に自分で再現確認済み（2026-07-27）
- `node -e "require('./_shared/render.js')"` OK
- `node --check tools/build-local.js` OK
- `node tools/build-local.js` 成功 → current=2026-09-12-vol24 upcoming=1 past=2

### 未着手
- 英語対応（/en/）、公開前タスク一式、実運用GAS実行（GitHubトークン未設定のため未実行）

## 守るべき不変条件（壊すと運用事故）
1. render.js は Node/GAS両対応の純粋関数のみ（require/fs/DriveApp/SpreadsheetApp禁止・ES2017まで）
2. render.js と render.gs は**同一内容**（片方だけ直さない・最も事故りやすい）
3. 画像ファイル名にコンテンツハッシュ（キャッシュ事故防止）
4. GitHub反映は Git Data API で1コミット（contents APIに戻さない）
5. アーカイブ判定は終演時刻ベース・Asia/Tokyo固定（日付比較に戻さない）
6. 未知の block type は無視（例外を投げない）
7. 公開前に validate_() で止める（検証スキップ分岐を足さない）
8. 動画をリポジトリに入れない（Pagesの容量・帯域上限）
9. `.nojekyll` を消さない（`_`始まりディレクトリがJekyllに無視される対策）

## 残タスク（優先順・HANDOFF §5）
- ~~**T1. 英語対応**~~ ✅ **完了（2026-07-27）**：render.jsにi18n層（UI_STRINGS辞書・loc()フォールバック・i18n()でhreflang/langSwitch/footer生成）。テンプレをプレースホルダ化（{{LANG}}{{HREFLANG}}{{LANG_SWITCH}}{{OG_LOCALE}}{{LANG_ROOT}}{{FOOTER_LINKS}}等・テンプレは2種のまま）。build-local.js/Code.gs を言語ループ化し `/en/` 配下を生成。events列に`title_en`/`lead_en`、blocks列に`title_en`/`body_en`（setupSheets・read関数・sample反映）。検証：`node tools/verify-links.js`（新規作成）で内部リンク184件切れ0・hreflang双方向0不足・英語空欄は日本語フォールバック確認済。**⚠️GAS反映は render.js を render.gs に貼り直しが必須（未実施）**
  - T1後続の候補：画像alt（`file|alt`のalt）とheroImage/ogpImage altは現状ja/en共通（未localize）。英語の正式表記（§6-5）確定後にsample/シートへ差し込み。英語版の法務ページ（attention/privacy/tokusho）はfooterから現状ja版へフォールバックリンク（T4で英語化検討）
- **T2. GASに翻訳ボタン**：Claude API（スクリプトプロパティ `ANTHROPIC_API_KEY`）で日本語→英語列を埋める。既存英語列は上書きしない
- **T3. チケット導線2系統化**：【判明 2026-07-27】チケットは**自社システム**（luxepartycom.github.io/event-system/・`?e=EV-xxx&type=free`でイベントID＋無料/有料を指定）。外部サービスではないので既存`entryUrl`でカバー可能。有料/無料でボタン文言を出し分けたい場合のみT3を実装（オーナー未指示のため保留）。支払い=カード事前決済 or 当日払い(現金・PayPayのみ)、キャンセル・返金不可
- **T4. 公開前タスク**（一部完了 2026-07-27）：
  - ✅ **404.html**：`_templates/404.html` 新規。GitHub Pagesはどの深さでも/404.htmlを返すため絶対パス（`absBasePath(baseUrl)`でbaseUrlのパス部分を抽出）で組む。日英併記・noindex,follow
  - ✅ **sitemap.xml**：`renderSitemap(suffixes,cfg)`。ja/en全URLを`<xhtml:link hreflang>`相互リンク付きで列挙（本番のみ生成）
  - ✅ **robots.txt**：`renderRobots(cfg)`。`Disallow: /preview/`＋Sitemap行（本番のみ生成）
  - ✅ **解析タグのconfig化**：config `ga4Id`(G-XXXX)/`metaPixelId` を追加。`analyticsHtml(ctx)`が`{{ANALYTICS}}`(head内)へGA4/Metaを注入。**ID空なら非挿入・preview(noindex)では計測しない**
  - ✅ **特商法ページ(tokusho.html)ドラフト**（2026-07-27）：申込ページ実文言（支払方法・キャンセル/返金不可・提供時期・入場注意）を反映。事業者情報は【要記入】マーク（事業者名/代表者/所在地/電話/メール）。**オーナー確認・記入後に確定＝§3法務承認事項**
  - ⏳ 残（オーナー入力/素材待ち）：OGP画像(1200×630)テンプレ・favicon/apple-touch-icon・法務残り（attention/privacy実内容）・特商法の事業者情報記入

## トップページ構成（2026-08-01 オーナー承認・実装済み）

トップ = 次回イベントを `renderEventPage` で描画（HERO＋ブロック群の1ページスクロール）。承認済みの並び：
1. **HERO**（次回イベント：日時・会場・CTA）
2. **CONCEPT**（`pastevents`ブロック）＝イベント説明文＋その配下に**過去イベントの写真カード帯**（PC3列・各カード=1過去イベント・日付/名称＋詳細ページへリンク・`ctx.pastEvents`から自動生成）。「前回のイベント」はこのCONCEPTに統合。
3. **THE NIGHT**（`text`＋フライヤー）＝次回詳細。左に詳細テキスト・右にフライヤー画像（塊をmax-width:1300pxでまとめ間延び防止）
4. **出演DJ・ダンサー**（`lineup`）＝写真カード（auto-fillで横に増える）
5. **VIP TABLE**（`table`）※HPでは大きく出さず、詳細/申込は別の申込URL(vip-plan)へ
6. **ACCESS**（`access`）
7. **ENTRY**（`entry`）最終CTA
8. **NEWS**（`news`）エントリーの下
9. **常時CTAバー**（`{{STICKY_CTA}}`・画面下固定・一般エントリー＋VIPの2ボタン・開催予定時のみ）

### 追加した render.js のブロック種別・仕様（2026-08-01）
- **`lineup` を写真カード化**：区切りを `/`→`|` に統一（URLの`/`衝突バグ修正）。形式 `名前|役割|リンクURL|画像ファイル名`。画像ありでカード、無しでテキスト行（後方互換）。alt=出演者名。CSS `.lineup-cards`。
- **`pastevents`（新規）**：`ctx.pastEvents`（現行除く過去イベント降順）から写真カード帯を自動生成。任意で本文(bBody)を上に置ける＝CONCEPT説明の配下に実例を並べる用途。CSS `.pastgrid`(1/2/3列)・`.pastcard`。
- **`prevevent`（新規・現在サンプル未使用）**：直近1件のスポットライト大カード。`ctx.prevEvent`。CONCEPT統合に伴いサンプルからは外したが種別は残置。
- **`text` にフライヤー画像対応**：`b.image="ファイル名|alt"` があれば本文の横に画像（`.text-with-flyer`：左テキスト・右画像・max-width:1300px）。
- **常時CTAバー**：`renderEventPage` が `{{STICKY_CTA}}` を生成（`ev.entryUrl`＋`ev.vipUrl`）。テンプレ event.html の footer 後に配置。events列に **`vipUrl`** を追加。
- build-local.js に `prevEvent`／`pastEvents` を ctx へ供給する処理を追加。**⚠️GAS本番反映時は build-local.js相当のctx構築を Code.gs にも反映＋render.js を render.gs に貼り直しが必要**（未実施）。

### 見た目プレビュー（自己完結Artifact・随時更新）
https://claude.ai/code/artifact/5fd4ba49-a6f9-4561-ad03-dba048d90563 （※Artifactは外部フォント不可で代替表示・画像はサンプル）

## 実データ投入：LUXE POOL PARTY（2026-08-01 進行中）

- **初の実イベントを投入**：`2026-08-09-luxe-pool-party`（LUXE POOL PARTY／8.9 SUN 18:00-21:30／歌舞伎町タワー5Fプールエリア）。サンプルの架空vol24を差し替え。アセットは `assets/2026-08-09-luxe-pool-party/`（暫定=vol24の複製画像）。
- **CONCEPT＝イベント全体の概念**（今回固有ではない・オーナー承認済み）：見出し「Fashion × Music × Luxury」＋Web用に起草した本文（インスタbioのSNS最適化を排し普遍化）。配下に過去イベント記録カード。
- **THE NIGHT＝今回固有の説明**（プライベートリゾート／IBIZA VIBES／DRESS CODE=Resort/White/Swimwear）＋フライヤー枠。CONCEPTと分離。
- **ENTRANCE**（tableブロック流用）：MEN¥20,000／WOMEN¥5,000／VIP要問合せ（フリードリンク付）。
- **LINE UP＝空なら自動非表示・素材が入れば自動でカード表示**（オーナー方針。renderは `!arts.length` で return に戻した）。
- **★差し替え待ち（プレースホルダ）**：ヒーロー/フライヤー/過去イベントの実写、エントリーURL（実`?e=EV-…`）、VIP問合せ先、CONCEPT配下の過去イベント（現状は架空NEON GARDEN/GOLD RUSH）。
- **連携方針**：本番設定前は「オーナーが内容を渡す→CEOが反映→プレビュー更新」。設定後はスプレッドシート/Drive自己編集へ移行。内容テンプレはセッションで共有済み。

## 🚀 本番公開済み（2026-08-03）＋動画/画像の取り込み方式

- **公開URL**：https://luxepartycom.github.io/luxe-site/ （GitHubリポジトリ `luxepartycom/luxe-site`・Pages `main`/root）。独自ドメインluxepartytokyo.comは未接続（次段階・decision 0035）。
- **デプロイ動線**：社内 `30_projects/.../luxe-site/` で編集・ビルド → オーナーが `/tmp/luxe-site-deploy` で `rsync -a --delete --exclude .git --exclude videos ... push`。**私のサンドボックスは `git remote add`・URL直push・gh がガードで不可**＝最終pushはオーナー端末。
- **動画＝自己ホストMP4**（重要）：**Googleドライブは`<video>`不可**（uc?export=downloadが添付DLで返る・CORS）。生データは53〜272MBの.mov＝そのまま不可。→ オーナーがDL後 ffmpeg で `-t 20 -an -vf scale=-2:720 -crf 28` に圧縮し `/tmp/luxe-site-deploy/videos/*.mp4` に配置（rsyncは`--exclude videos`で保持）。`ev.heroVideo="videos/xxx.mp4"`。HERO=背景全面自動再生、過去=9:16リール（object-fit:cover）。
- **画像＝Drive URLで直接OK**（DL不要）：`imgUrl()`が `drive.google.com/file/d/ID/` を `drive.google.com/thumbnail?id=ID&sz=w2000`（→lh3.googleusercontent.com CDN）へ変換。`<img>`で正常表示（プローブ確認済）。フライヤー・出演者写真はDrive共有リンクを貼るだけ。**共有は「リンクを知っている全員」必須**。
- **SNS/VIP**：footer=Instagram(@luxe_party_tokyo)＋LINE(page.line.me/179pvefo)。**VIP窓口＝公式LINE誘導**（VIPボタン・ENTRANCE行ともLINE）。一般エントリー/VIPのCTAは常時表示バー。
- **LINE UP（出演者）**：`名前 \| 役割 \| SNS \| 写真`。写真もDrive URL可。空なら自動非表示・入れば自動カード表示。
- **残タスク**：OGP画像(1200×630)・favicon・独自ドメイン接続・GA4・法務ページ内容確定(特商法は株式会社リュクスで下書き)・出演者ロースター。

## デザイン確定事項
- **背景トーン：黒基調で確定**（オーナー承認 2026-07-27）。配色＝ink#0B0A10(ほぼ黒)×champagne#D8B26A(金)×blush#E9DDC9(クリーム)、velvet/smokeの紫で深み。ナイトイベントの世界観・高級感の表現。変更提案の必要なし。

## 見た目プレビュー
`node tools/build-local.js && node tools/inline-preview.js <page> <out> [--body-only]` で自己完結HTML（CSS埋込・画像データURI化）を生成→Artifact/ブラウザで確認。外部フォントはCSP環境で代替表示（実サイトは専用フォント）。
- 2026-07-27 トップ(vol24)プレビュー公開：https://claude.ai/code/artifact/4d0a1090-a7e4-4208-9481-60d205b95c09
- **T5. ドメイン切替**：CNAME＋DNS。**§6-1の回答が前提。それまで着手しない**

## ブロッカー（オーナー回答待ち・着手前に確認）
1. **ドメインと既存登録システムの配置**：新サイトをドメイン直下に置くと稼働中の登録システムURLが死ぬ（配布済みQR・DMリンクも切れる）。推奨案＝登録システムを `entry.<domain>` に分離。**未決。T5はこの回答まで着手しない**
2. **外部チケットサービスの名称**（T3の導線・ボタン文言が変わる）
3. **特商法の記載内容**：事業者名・所在地・連絡先・キャンセル規定
4. **実写素材**：ヒーロー・OGP・ギャラリー
5. **英語の正式表記**：イベント名・会場名

## オーナー操作が必要なもの（物理的に不可能）
- GitHubリポジトリ新規作成・Pages設定（初回セットアップ）
- GitHub Fine-grained token 発行→スクリプトプロパティ `GITHUB_TOKEN` 登録
- Drive親フォルダ＋イベントIDフォルダ作成・画像配置
- スプレッドシート作成→Apps Scriptに Code.gs/render.gs 貼付→「シートのひな形を作る」実行→config記入
- （T2用）`ANTHROPIC_API_KEY` をスクリプトプロパティ登録

## 開発・検証手順
```bash
node tools/build-local.js                                    # 生成（ja + en 両方）
node tools/verify-links.js                                   # 内部リンク切れ・hreflang双方向を自動検査
python3 -m http.server 8000                                  # → localhost:8000 で確認
node -e "require('./_shared/render.js')" && node --check tools/build-local.js  # 構文
```
変更後の毎回チェック：全ページ巡回リンク切れ0／幅360px横スクロール無/開催予定=ENTERあり・ENDED無/過去=ENTER無・ENDEDバッジ/published外し行が出力されない/深夜またぎが開催中にアーカイブ入りしない

## 落とし穴
- GAS反映漏れ：render.js を直しても render.gs に貼り直さないと本番不変（最頻事故）
- GitHubトークン期限切れ：突然全失敗→まずここを疑う
- Driveフォルダ名がイベントIDと不一致→画像が出ない（エラーにならず単に出ない）
- 制限環境ではGoogleフォント読込失敗→フォールバック表示（デザイン崩れではない）

## 出典
引き継ぎ資料：本階層の `HANDOFF_LUXE-SITE.md` / `README.md`
元zip：`~/Downloads/luxe-site.zip`（2026-07-27展開）
