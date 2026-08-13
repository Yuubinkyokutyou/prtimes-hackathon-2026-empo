# 本番データの一部をCSVで開発DBへ反映する

pg_dumpを使わず、直近1年のデータを各テーブル最大1,000件に抑えて移行する手順です。
`release`を基準に対象を決め、外部キーで必要になる親・マスタも同じデータセットへ含めます。

## 開発DBをCSVの内容へ完全に置き換える（推奨）

このリポジトリでは、抽出済みの15個のCSVを `database/production_subset/csv/` で管理しています。

Docker ComposeのDBが起動している状態で、リポジトリルートから次を実行します。

```bash
npm run db:replace-production-subset -- --yes
```

このコマンドはCSVの存在とヘッダーを確認し、ステージングへ取り込んで主キー・外部キーを検証します。検証に成功した場合だけ、開発DBの15テーブルを空にしてCSVの内容へ置き換えます。削除と再投入は同一トランザクションのため、途中で失敗した場合は元のデータへロールバックされます。

> **注意:** `--yes` は既存の開発データ（ダミーデータを含む）をすべて削除する確認オプションです。本番DBに接続するCompose設定では実行しないでください。

## 1. 本番DBからCSVを出力

pgAdminで本番DBの Query Tool を開き、
[`00_export_from_production.sql`](./00_export_from_production.sql) を開きます。

1. ファイル先頭から「CSV出力用SELECT」の直前までを実行します。
2. 件数確認結果を確認します。
3. `01_prefecture.csv` から `15_webclipping_list.csv` まで、各SELECTを1つずつ選択実行します。
4. Data Output の **Download as CSV** で、コメントに書かれたファイル名で保存します。

CSVは **Headerあり / UTF-8** で保存してください。TEMP TABLEを共有しているため、15ファイルを出力し終えるまで同じQuery Toolタブと接続を使います。

抽出条件を変える場合は、ファイル先頭の次の値だけ変更します。

```sql
VALUES (1, 1000); -- 過去1年、各対象テーブル最大1,000件
```

## 2. 開発DBにステージングを作成

開発DBの Query Tool で
[`10_create_staging_in_development.sql`](./10_create_staging_in_development.sql) を実行します。

次に pgAdmin のツリーから `Schemas > prod_subset_import > Tables` を開きます。各テーブルを右クリックして **Import/Export Data** を選び、対応するCSVをImportします。

- Format: `csv`
- Header: `Yes`
- Encoding: `UTF8`
- Delimiter: `,`
- Quote: `"`
- Escape: `"`
- Null string: `NULL`
- Columns: 全列（CSVの列順のまま）

空のCSV（ヘッダーしかないもの）はImportを省略できます。

## 3. publicへ反映

15ファイルのImport後、開発DBの Query Tool で
[`20_apply_to_development.sql`](./20_apply_to_development.sql) を実行します。

外部キー順に反映し、主キーが既にある行は本番の値で更新します。対象外の既存ダミーデータは残ります。最後の結果で、各行の `csv_rows` と `matched_in_public` が一致していれば反映完了です。

既存ダミーデータも削除する場合は、手動Import後に
[`25_validate_staging.sql`](./25_validate_staging.sql)、続けて
[`30_replace_development_data.sql`](./30_replace_development_data.sql) を実行します。

## 注意事項

- CSVには本番由来のデータが含まれます。リポジトリのアクセス権限と取扱方針を確認してください。
- 本番DBではSELECTとTEMP TABLE作成だけを行い、既存データは更新・削除しません。
- `created_at IS NULL` のrelease、または直近1年より古いreleaseは対象外です。
- 子テーブルは各最大1,000件です。1リリースに多数のkeywordやweb clippingがあっても、一部のリリースだけに偏らない順序で抽出します。
- ステージングを作り直すSQLは `prod_subset_import` スキーマだけを削除します。`public` は削除しません。
