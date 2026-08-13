# アプリ用データベースマイグレーション

このプロジェクトでは、分析データとアプリ固有データを分離して管理します。

- `init.sql`: 本番由来の分析テーブルをローカル開発DBへ再現するための初期化SQL
- `public` スキーマ: `company`、`release` などの分析テーブル
- `app` スキーマ: アプリが所有するテーブル
- `migrations/*.sql`: `app` スキーマを変更する番号付きマイグレーション
- `app_migrations.schema_migration`: 適用済みマイグレーションの履歴

`init.sql` を本番RDSへ適用してはいけません。本番RDSに対して適用するのは `migrations/*.sql` だけです。

## 新しいテーブルを追加する

適用済みファイルは編集せず、次の番号でSQLファイルを追加します。

```text
migrations/
  001_create_app_schema.sql
  002_create_user_account.sql
  003_create_saved_release.sql
```

例:

```sql
-- migrations/002_create_user_account.sql
CREATE TABLE app.user_account (
    user_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email varchar(255) NOT NULL UNIQUE,
    display_name varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

分析テーブルを参照するときは、スキーマ名を明示します。

```sql
CREATE TABLE app.saved_release (
    user_id bigint NOT NULL REFERENCES app.user_account(user_id) ON DELETE CASCADE,
    company_id integer NOT NULL,
    release_id integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, company_id, release_id),
    FOREIGN KEY (company_id, release_id)
        REFERENCES public.release(company_id, release_id)
        ON DELETE CASCADE
);
```

各SQLファイルは実行プログラムがトランザクションで囲むため、ファイル内に `BEGIN` と `COMMIT` は書きません。

## 適用方法

ローカルとEC2のどちらも、`docker compose up` の前に `migrate` サービスが未適用分だけを実行します。同じマイグレーションを再実行してもスキップされます。

ローカルで手動適用する場合:

```bash
docker compose run --rm migrate
```

EC2からRDSへ手動適用する場合:

```bash
docker compose --env-file .env.ec2 -f compose.ec2.yaml run --rm migrate
```

Dockerを使わない場合:

```bash
DATABASE_URL=postgresql://... \
DATABASE_SSL=false \
npm run migrate
```

## 適用状況を確認する

```sql
SELECT version, applied_at
FROM app_migrations.schema_migration
ORDER BY version;
```

アプリ用テーブルの一覧:

```text
\dt app.*
```

## 運用ルール

- 適用済みマイグレーションを編集しない。チェックサム不一致としてエラーになります。
- 適用済みマイグレーションファイルを削除しない。DB履歴にあるファイルが見つからない場合もエラーになります。
- 変更は常に新しい番号のファイルとして追加する。
- `DROP TABLE`、カラム削除、型変更などの破壊的変更は、バックアップと復旧手順を確認してから適用する。
- マイグレーションが失敗した場合はアプリを起動しない。Composeも `migrate` の成功を待ってbackendを起動します。
- ハッカソン後は、マイグレーション用DBユーザーとアプリ実行用DBユーザーの権限分離を検討する。
