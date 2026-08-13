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

EC2 では `compose.ec2.yaml` を使います。この Compose に PostgreSQL は含まれず、RDS for PostgreSQL に接続します。

AWS リソースの作成、セキュリティグループ、Amazon Linux 2023 のセットアップ、RDS の初期化、デプロイ、疎通確認までの手順は [EC2 + RDS デプロイ手順](docs/EC2_RDS_DEPLOY.md) を参照してください。

## 環境変数

| 変数 | 用途 | 例 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 接続文字列 | `postgresql://user:pass@db:5432/app` |
| `DATABASE_SSL` | RDS への TLS 接続 | `true` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | 証明書検証（ハッカソンは `false`、本番は `true`） | `false` |
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
