# 非常食ナビ

家庭での食料備蓄を検討するための日本語情報サイトです。Hugo + PaperModを使用し、Cloudflare PagesのGit連携で配信します。

- 本番URL：<https://hijoshoku-navi.com/>
- Pages URL：<https://hijoshoku-navi.pages.dev/>
- 本番ブランチ：`main`
- Hugo：`0.166.0`（互換確認：`0.147.7`）

## 開発

```sh
git submodule update --init --recursive
hugo server
```

PaperMod本体は直接編集せず、`layouts/`・`assets/`・`static/`で拡張します。

## 品質確認

```sh
npm ci
npx playwright install chromium
npm test
```

macOSではインストール済みのGoogle Chromeを使用します。その他の環境ではPlaywrightのChromiumを使用します。任意のブラウザ実行ファイルは`PLAYWRIGHT_EXECUTABLE_PATH`、Hugo実行ファイルは`HUGO_BIN`で指定できます。

テストは一時ディレクトリへHugoをビルドし、localhostだけで配信します。320px・390px・768px・1440pxで主要ページ、見出し、メタ情報、内部リンク、画像、ページ全体の横はみ出し、ブラウザエラーを検査し、スクリーンショットを保存します。保存先は実行結果に表示されます。`ARTIFACT_DIR`で保存先を指定できます。

本番canonicalを維持してローカル検証するため、ブラウザテスト中のみ`hijoshoku-navi.com`宛てリクエストをローカルビルドへ差し替えます。これは本番DNS・本番配信の検証ではありません。

## Cloudflare Pages設定

| 項目 | 値 |
|---|---|
| Framework | Hugo |
| Build command | `hugo --minify` |
| Output directory | `public` |
| Root | リポジトリ直下 |
| Environment | `HUGO_VERSION=0.166.0` |

Workersの`wrangler deploy`経路ではありません。ドメイン設定はPagesのCustom domainsで管理します。

## コンテンツの更新ルール

- 公的な備蓄情報は公的機関、商品仕様はメーカー一次情報を確認します。
- 出典、確認日、対応する製品名・仕様をセットで管理します。参照記録は`docs/sources/`、読者向けの出典は記事内に置きます。
- 未確認の価格・成分・水量・栄養量を推測で埋めません。保留情報を「要確認」のまま公開しません。
- 検証していない実食体験、売上実績、順位・受賞を記載しません。
- 人数・日数の例は検算し、食数と栄養充足を区別します。
- アフィリエイトを導入する際は記事・編集方針・プライバシー説明を整合させ、通常リンクと広告リンクを区別します。秘密情報はリポジトリに保存しません。

## 公開前チェック

1. `npm test`と`hugo --minify`を実行する。
2. スマホ・PCのスクリーンショットと出典を確認する。
3. 差分を別のレビュアーが確認し、重大な指摘を解消する。
4. GitHubに反映後、Pagesのデプロイ結果と公開ページを別途確認する。

公開成功、DNSによる通常アクセス成功、アフィリエイト報酬の発生は、それぞれ別の確認事項です。
