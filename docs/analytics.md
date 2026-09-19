# 本番限定のアクセス解析

GA4の送信先は `G-28DEZ2ELZ3`。`data/analytics.json` の `enabled` が明示的な `true` の場合だけ有効にする。ビルド時に本番baseURL・題材の一致を確認し、実行時も `https://hijoshoku-navi.com` の完全一致（別ポートも不可）と生成済みページの正規パスを確認する。localhost・Pages preview・別題材・404・未知パスの200フォールバックではGoogleタグを読み込まない。停止時は `enabled: false` にして再ビルド／配信する。

## 送信の範囲

- Google tagの通常のpageviewと、管理画面で有効にした外部リンククリックを利用する。GA標準のセッション・エンゲージメント情報とCookie識別子は発生するため、無識別・完全匿名とは説明しない。
- `page_location` は生成済み正規URLだけ。クエリ・fragmentは含めず、`page_referrer` はHTTP(S)のoriginだけにする。ページタイトルもビルド時の固定値。タグ読込のHTTP referrerは送らない。
- 計算・メモ・ユーザーID・localStorageなどは解析コードから参照しない。カスタムイベント、独自識別子、計算結果の送信、クロスドメイン設定、広告タグは追加しない。
- `allow_google_signals` / `allow_ad_personalization_signals` はfalse。consent defaultは `ad_storage` / `ad_user_data` / `ad_personalization` をdenied、`analytics_storage` をgrantedとする。これは本実装のCookie解析設定であり、利用者による同意操作の記録ではない。対象地域や同意取得要件が変わる場合は配信前に別途対応する。
- 外部リンクは公開済みの固定URLと商品検索語だけを使用。入力からURLやリンク文言を生成しない。新しいリンクを追加する際も、個人情報や広告識別子が含まれないか確認する。
- Googleタグの失敗・遮断は計算やメモ保存から独立している。

## 管理画面との境界（公開前に確認）

ソースだけではGAの拡張計測設定を変更できない。フォーム／スクロール／サイト内検索／ファイル／動画、Google Signals、ユーザー提供データ収集、広告パーソナライズがOFFであることを運用側で維持する。

**pageviewの詳細設定「ブラウザの履歴イベントに基づくページの変更」もOFFであることを確認する。** Google公式資料では、`send_page_view: false` にしても拡張計測の履歴イベントは止まらない。本実装は通常読込の `send_page_view: true` だけを設定し、独自の履歴リスナーやpageviewイベントは追加しない。履歴設定OFFの実画面確認はソースのテストでは代替できず、未確認のまま「自動履歴計測なし」と断定しない。

## 検証と受信確認

```sh
node tests/analytics.spec.mjs
npm test
HUGO_BIN=/path/to/hugo-0.147.7 npm test
hugo --panicOnWarning --minify
```

自動テストは実HTMLと自前JSを仮想本番URLで動かし、全外部通信を遮断／mockする。正しいID・config・広告設定・本番以外の通信ゼロ・入力sentinel非送信・保存・JS失敗・noJS・題材交換を検証し、静的外部リンク一覧も記録する。`analytics-fixture-evidence.json` のcollectは、キューを直列化する**ローカルfixture**であり、Googleの実装や受信の証明ではない。実タグが自動収集する内容の最終確認は次の配信後検証で行う。

公開担当者の確認手順：

1. 承認済みの本番配信後、上記の管理画面設定と送信先をreadbackする。履歴イベント設定が未確認なら先に確認する。
2. 拡張機能なしの一時ブラウザで本番homeと記事を開く。Networkで `gtag/js?id=G-28DEZ2ELZ3` と実 `g/collect` を確認。`tid`、`en`、`dl`、`dr`、広告consent値を確認し、ページURLにquery/hashがないこと・referrerにパスやqueryがないことを記録する。Cookie/クライアントID等を含む生のHARは公開repoへ保存しない。
3. 個人情報ではない試験sentinelをクエリ・メモへ入れ、計算／保存／外部リンククリック／hash移動を実行。全Googleリクエストにsentinelがないこと、form/search/scroll/file_downloadイベントや履歴由来の追加pageviewがないことを確認する。外部リンクには固定の商品検索語だけが含まれることを照合する。
4. GA4のRealtimeで当該ページの `page_view`、固定外部リンクの `click` を確認する。Network成功とRealtime受信は別々に記録し、処理待ち／未確認ならそのまま明記する。必要に応じたDebugViewは担当者の一時デバッグ環境だけで使い、本番コードへdebug_modeを常設しない。
5. preview/localhost/404でGoogleリクエストがないこと、タグ遮断時も計算・保存が機能することを再確認する。

## 参照したGoogle一次資料

- [Google tagの標準導入構文](https://developers.google.com/tag-platform/gtagjs/install)
- [pageviewと履歴イベントの制御](https://developers.google.com/analytics/devguides/collection/ga4/views)
- [page_location、page_referrer、Cookie、広告設定](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [consent defaultの順序と構文](https://developers.google.com/tag-platform/security/guides/consent)

既存 `editorial-ux.spec.mjs` の「GA未導入」は、本番限定導入の契約へ変更した。localhost/noJSでremote scriptなしの検証は維持し、通信・ID・入力の保護は新しい解析専用テストで確認する。出典台帳、数値検証、計算、実ファイル保存、noJSの既存assertは変更しない。
