# チームエンポー

React + Node.js/TypeScript + PostgreSQL で構成したアプリケーションです。

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

初回起動時にルートの `init.sql` が自動実行されます。DB のデータを作り直す場合は、開発データが消えることを確認してから `docker compose down -v` を実行し、再度起動してください。

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
npm run typecheck  # TypeScript の型検査
npm test           # backend のテスト
```

## EC2 + RDS へのデプロイ

EC2 では `compose.ec2.yaml` を使います。この Compose に PostgreSQL は含まれません。

1. RDS for PostgreSQL を作成し、EC2 のセキュリティグループから RDS の 5432/TCP への接続を許可します。
2. RDS に `init.sql` を一度だけ適用します。

   ```bash
   psql "host=<RDS_ENDPOINT> port=5432 dbname=<DB_NAME> user=<DB_USER> sslmode=require" -f init.sql
   ```

3. EC2 上で `.env.ec2.example` を `.env.ec2` にコピーし、`DATABASE_URL` と `CORS_ORIGIN` を変更します。
4. 起動します。

   ```bash
   docker compose --env-file .env.ec2 -f compose.ec2.yaml up -d --build
   ```

5. 確認します。

   ```bash
   curl http://localhost/api/health
   curl http://localhost/api/health/db
   ```

本番では EC2 の 80 番ポートを直接公開するより、ALB または HTTPS を設定したリバースプロキシを前段に置く構成を推奨します。RDS は public access を無効にし、認証情報は AWS Systems Manager Parameter Store または Secrets Manager で管理してください。

## 環境変数

| 変数 | 用途 | 例 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 接続文字列 | `postgresql://user:pass@db:5432/app` |
| `DATABASE_SSL` | RDS への TLS 接続 | `true` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | 証明書検証（通常は `true`） | `true` |
| `PORT` | API の待受ポート | `3000` |
| `CORS_ORIGIN` | 許可するフロントの Origin（カンマ区切り可） | `https://example.com` |
| `VITE_API_BASE_URL` | ブラウザから見た API のパス | `/api` |

## ディレクトリ

```text
frontend/          React + Vite + TypeScript
backend/           Express + TypeScript + node-postgres
init.sql           DB スキーマ
compose.yaml       ローカル開発用（PostgreSQL を含む）
compose.ec2.yaml   EC2/RDS 用（PostgreSQL を含まない）
```
