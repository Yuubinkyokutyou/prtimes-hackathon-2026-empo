# チームエンポー

React + Node.js/TypeScript + PostgreSQL で構成したアプリケーションです。

過去のプレスリリースをもとにした次回企画と、まだ発信していない企業の魅力を発見する企画を提案するダッシュボードです。API キー未設定時はダミーデータで全画面・操作を確認できます。

## 必要なもの

- Docker Desktop（Docker Compose v2 を含む）
- Docker を使わず動かす場合は Node.js 22 と PostgreSQL 16

## ローカル開発（推奨）

```bash
cp .env.example .env
docker compose up --build
```

- フロントエンド: http://localhost:5173
- API: http://localhost:3000/api/health
- PostgreSQL: `localhost:5432`（使用中の場合は `.env` の `POSTGRES_PORT` を変更）

初回起動時に、分析テーブルを開発環境へ再現するためのルート `init.sql` とデモ用の `seed.sql` がローカルDBだけに自動実行されます。その後、`migrations/*.sql` にあるアプリ用マイグレーションが適用されます。DB のデータを作り直す場合は、開発データが消えることを確認してから `docker compose down -v` を実行し、再度起動してください。

標準設定ではローカルの `database/production_subset/csv` に配置した抽出データをバックエンドが直接読み取り、既存の開発DBを書き換えずに表示します。本番由来情報を含むためCSV本体はGit管理対象外です。DBへ完全に反映して検証したい場合だけ、次を実行します。

```bash
npm run db:replace-production-subset -- --yes
```

### Docker を使わず起動する場合

```bash
npm install
npm run dev
```

この場合も PostgreSQL は必要です。`backend/.env.example` を `backend/.env` にコピーし、接続先を設定してください。

## 主なコマンド

```bash
npm run dev        # frontend / backend を同時起動
npm run build      # 両方をビルド
npm run migrate    # アプリ用DBマイグレーションを適用
npm run typecheck  # TypeScript の型検査
npm test           # backend のテスト
npm run db:replace-production-subset -- --yes # 開発DBをproduction_subsetへ置換
```

## EC2 + RDS へのデプロイ

EC2 では `compose.ec2.yaml` を使います。この Compose に PostgreSQL は含まれず、RDS for PostgreSQL に接続します。

AWS リソースの作成、セキュリティグループ、Amazon Linux 2023 のセットアップ、アプリ用マイグレーション、デプロイ、疎通確認までの手順は [EC2 + RDS デプロイ手順](docs/EC2_RDS_DEPLOY.md) を参照してください。

`init.sql` は分析環境をローカルに再現するためのもので、本番RDSへは適用しません。アプリ固有テーブルの追加方法は [アプリ用データベースマイグレーション](docs/DATABASE_MIGRATIONS.md) を参照してください。

## 環境変数

| 変数 | 用途 | 例 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 接続文字列 | `postgresql://user:pass@db:5432/app` |
| `DATABASE_SSL` | RDS への TLS 接続 | `true` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | 証明書検証（ハッカソンは `false`、本番は `true`） | `false` |
| `PORT` | API の待受ポート | `3000` |
| `CORS_ORIGIN` | 許可するフロントの Origin（カンマ区切り可） | `https://example.com` |
| `VITE_API_BASE_URL` | ブラウザから見た API のパス | `/api` |
| `OPENAI_API_KEY` | 提案生成と埋め込み作成（未設定時はデモモード） | `sk-...` |
| `OPENAI_TEXT_MODEL` | 提案文生成モデル | `gpt-5-mini` |
| `OPENAI_EMBEDDING_MODEL` | 過去記事との類似度計算用モデル | `text-embedding-3-small` |
| `OPENAI_TIMEOUT_MS` | OpenAI API のタイムアウト（ms） | `300000` |
| `RECOMMENDATION_DATA_SOURCE` | データ取得元（`production_subset` / `auto` / `database` / `mock`） | `production_subset` |
| `PRODUCTION_SUBSET_DIRECTORY` | production_subset CSVディレクトリ | `database/production_subset/csv` |
| `RECOMMENDATION_CACHE_TTL_MS` | 生成結果のキャッシュ時間（ms） | `900000` |
| `RECOMMENDATION_STALE_AFTER_DAYS` | 左側の過去記事活用案を優先する最終投稿日からの日数 | `60` |

OpenAI API キーはバックエンドだけが参照します。フロントエンド用の `VITE_` 変数には入れないでください。初回アクセス時に構造化出力で企画文を生成し、結果を15分間キャッシュします。過去記事・他社事例・提案文は Embedding に変換し、コサイン類似度を使って参考事例の抽出と提案順の決定を行います。類似度は内部評価にのみ使用し、画面には表示しません。

## ダミーデータから実データへの差し替え

企業情報と過去配信は `RecommendationContextProvider` に集約しています。通常は `PostgresRecommendationContextProvider` が `company`、`release`、`release_statistic`、`release_keyword` などから取得し、DBに接続できない開発環境だけseed準拠モックへ戻ります。`RECOMMENDATION_DATA_SOURCE=database` を設定すると、DB障害時にフォールバックせずエラーとして検出できます。

ローカルでは `RECOMMENDATION_DATA_SOURCE=production_subset` を標準とし、CSVを直接参照します。開発DBそのものをCSVへ置き換える必要がある場合だけ、次のコマンドで主キー・外部キーを検証してから置き換えます。

```bash
npm run db:replace-production-subset -- --yes
```

画面が企業IDを指定しない場合、配信件数が多い企業をDBから自動選択します。最終配信から60日以上空いている企業は左側の過去記事活用案、60日未満の企業は右側の新しい切り口を優先して生成します。しきい値は `RECOMMENDATION_STALE_AFTER_DAYS` で変更できます。

特定企業を確認する場合は `http://localhost:5173/?companyId=<company_id>` のようにURLで企業IDを指定できます。画面の基本レイアウトは変わりません。

## 提案API

- `GET /api/recommendation-companies`: 配信実績のある企業一覧
- `GET /api/recommendations?companyId=<company_id>`: キャッシュ済み提案、または初回生成（省略時はDBから自動選択）
- `POST /api/recommendations/generate`: キャッシュを更新する再生成

## ディレクトリ

```text
frontend/          React + Vite + TypeScript
backend/           Express + TypeScript + node-postgres
init.sql           分析テーブルをローカル開発DBへ再現する初期化SQL
seed.sql           ローカル開発用のデモデータ
migrations/        アプリ固有テーブル用の番号付きマイグレーション
compose.yaml       ローカル開発用（PostgreSQL を含む）
compose.ec2.yaml   EC2/RDS 用（PostgreSQL を含まない）
```
