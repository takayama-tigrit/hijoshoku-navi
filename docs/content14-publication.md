# CONTENT-14：校正済みの画像版2記事

## 対象と承認

- `posts/emergency-canned-food/`：ホテイやきとりたれ味75gと月花さば水煮200gの比較。
- `posts/supermarket-emergency-food-list/`：スーパー・ドラッグストアで買い足す6カテゴリの確認。
- 本文への確認と公開承認を保持し、`CONTENT-14-VISUAL-V3`の追加文・alt・販売単位・広告表示は別途本人の校正・事実確認を受けています。
- 公開用の固定記録は `reviews/content-14-visual-human-confirmation.json`。確認時の原稿SHA-256、公開bytes、表示依存ファイルを結びます。切り替えるのは `draft: true` から `draft: false` のみです。
- 元の校正HTML・商品画像入りの画面証跡・内部作業ログは非公開の監査領域に保持します。公開記録はそれらの識別hashと、再検証可能な配信入力のmanifestです。CIで原HTMLを再取得・再配布するものではありません。
- この記録は将来の未執筆文面、Amazon再申請、SNS投稿、課金、削除を承認しません。

## 旧記事からの分離

旧12記事の本文、`data/article-evidence.json`、既存の `docs/sources/ledger.json` / `retrieval.json`、旧校正pinは変更しません。新2記事の命題対応は `data/article-evidence-content14.json`、追加出典は `docs/sources/content14/` に分離し、検証時のみ衝突検査後に統合します。

写真・マーカー用データは `data/content14-visual.json`、ASPの正式商品コードは `data/content14-product-images.json`、カテゴリ写真の権利根拠は `docs/image-licenses-content14.json` に保存します。既存の水写真は旧権利台帳を参照します。

この2記事の必須CC BY帰属は、写真パネル内のnative detailsからJSなしでも確認できます。既存編集契約の「不要な許諾detailsを付けない」は、この必須帰属を省略する意味ではありません。カテゴリ写真は導入用で、掲載商品の現物比較や食品安全の根拠には用いません。

## 維持する検証

```sh
python3 -B scripts/content14_confirmation.py
python3 -B docs/sources/verify.py
python3 -B tests/content14-confirmation.spec.py
python3 -B tests/content14-evidence-optimization.spec.py
REQUIRE_REAL_IMAGES=1 node tests/content14-public.spec.mjs
npm test
```

承認の結果・確認者・版・packet・本文・依存ファイルの改変、欠落とPython最適化による迂回を拒否します。公開モードの全suite、対象Hugo両版、320/390/1440px・JS有効/無効の表示、8つの写真と強調された判断条件、広告の有効/preview/別origin/disabledを検証対象にします。元記事を変更しないdraft除外fixtureも保持します。

公開後は実URLのHTTP応答、本文DOM、配信asset、画像の実decode、記事への到達を別途確認します。ローカル成功を本番配信成功、ブラウザエミュレーションを実機iPhone、自己QAを自然読者の行動・SEO・収益改善とは扱いません。
