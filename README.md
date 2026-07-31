# 体育館空き状況チェックシステム

複数の体育館予約サイトを定期的に巡回し、2時間以上の連続した空き枠を検出します。GitHub Actions上で15分間隔の定期実行を想定しています。空き状況に変化があった場合のみ、前回との差分とダッシュボードへのリンクをLINEグループへ通知します。あわせて、全サイトの最新の空き状況をまとめて見られるダッシュボードをGitHub Pagesで公開しています。

## 対象サイト

| サイトID | 施設 | 対象期間 | 実装方式 |
|---|---|---|---|
| `okegawa` | 桶川サンアリーナ（バドミントン） | 3ヶ月先まで | 静的HTML取得（axios/cheerio） |
| `hasuda` | 蓮田市 総合市民体育館パルシー／農業者トレーニングセンター | 3ヶ月先まで | Playwright（ASP.NET WebForms） |
| `ageo` | 上尾市 自動車精工　上尾市民体育館（アリーナ） | 2ヶ月先まで | Playwright（Vue SPA） |

土日祝日のみが対象です。設定は [`src/config/sites.js`](src/config/sites.js) にまとまっています。

## セットアップ

```bash
npm install
cp .env.example .env   # LINE_TOKEN, LINE_GROUP_ID を設定
npm start
```

## GitHub Actionsでの定期実行

- `.github/workflows/check.yml` が15分間隔(`*/15 * * * *`)で実行します。
- リポジトリの Settings → Secrets and variables → Actions に `LINE_TOKEN` / `LINE_GROUP_ID` を登録してください。
- 前回結果・週次キャッシュ（`data/state/`）は `actions/cache` で実行間を引き継ぎます。

## 仕組み

1. `src/index.js` が `src/config/sites.js` の設定を順番に処理します。
2. 各サイトのアダプター（`src/sites/*.js`）が空き状況を取得し、2時間以上連続で空いている枠を抽出します（`minVacantMinutes: 120`）。
3. 前回結果（`data/state/<siteId>.json`）と比較し、追加/削除された枠がある場合のみLINEへ通知します（`src/index.js` の `buildDiffMessage`）。通知には枠の詳細を列挙せず、「🏀 体育館空き状況監視システム」というタイトルとダッシュボードへのリンクのみを送り、詳細はダッシュボード側（および通知履歴タブ）で確認する設計にしています。エラー発生時のみ、エラー内容もあわせて通知します。
4. `hasuda`・`ageo`（Playwright使用サイト）は、部屋×日付単位の週次ステータスをキャッシュ（`data/state/fingerprints/<siteId>.json`）し、前回と状態が変わっていないコマは詳細画面への再アクセスをスキップします。サイトへの負荷と実行時間を抑えるための仕組みです。

`hasuda`・`ageo`は詳細ページのURLがセッション状態に紐づいており、時間が経つとアクセスできなくなる（第三者は最初からアクセスできない）ため、通知・ダッシュボードのリンクは各サイトのトップページ（`entryUrl`/`homeUrl`）を指します。`okegawa`は日付をクエリparamで指定する静的URLのため、該当日のページに直接リンクできます。

## ダッシュボード

`docs/` 以下が静的なダッシュボード（HTML/CSS/バニラJS、ビルド不要）で、GitHub Pages（Settings → Pages → Source: `main` ブランチ / `/docs`）で公開します。

- チェック実行のたびに `src/index.js` が全サイトの最新結果を `docs/data.json` に書き出します。
- ワークフローは変更があった場合のみ `docs/data.json` をコミット・pushします（`chore: update dashboard data`）。
- サイトのチェックが失敗した回は、ダッシュボード上はエラー表示を出しつつ前回正常時の結果を維持します（`error` / `lastErrorAt` フィールド）。
- 表示側（`docs/app.js`）は5分おきに `data.json` を再取得し、会場別・枠の長さ（2時間以上／3時間以上）・曜日（土/日/祝）でのフィルタ、ライト/ダーク切り替えに対応しています。

## 新しいサイトを追加するには

1. `src/sites/<siteId>.js` に `checkSite(siteConfig)` を実装するアダプターを作成する（既存アダプターを参考に）。
2. `src/config/sites.js` にサイト設定を追加し、`adapter` フィールドで上記ファイル名(拡張子なし)を指定する。
3. `src/index.js` の `adapters` マップに追記する。

サイトがASP.NET WebFormsやVue/React等のSPAで作られている場合、単純なHTTP GETでは空き状況ページに到達できないことが多いため、Playwrightでの実装が基本になります（`src/sites/hasuda.js` / `src/sites/ageo.js` を参照）。

## 既知の制限・今後の課題

- `data/state/` はGitHub Actionsのキャッシュ機能で引き継いでいる暫定対応です（`docs/data.json`はgit管理下のため永続化されますが、`data/state/`のキャッシュ自体はActionsキャッシュの保持期間・容量に依存します）。
- Playwright使用サイトは初回実行（キャッシュなし）が特に重くなります。サイトの利用規約を確認のうえ、必要に応じて実行間隔やチェック範囲を調整してください。
- 上尾サイトはフェーズ1とフェーズ2で同一週への再訪問時に対象セルが見つからないことが稀にあります（クラッシュはせずスキップされ、次回再検出されます）。
