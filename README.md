# チームエンポー

React + Node.js/TypeScript + PostgreSQL で構成したアプリケーションです。

ダッシュボード上部のレコメンド導線については、[機能解説ドキュメント](docs/dashboard-recommendation-banner.md)を参照してください。

過去のプレスリリースをもとにした次回企画と、まだ発信していない企業の魅力を発見する企画を提案するダッシュボードです。OpenAI API キー未設定時も、選択したデータソースの企業情報と配信実績からテンプレートで提案を作成します。

## Codex App の worktree セットアップ

Codex App が作る managed worktree では、リポジトリ直下の `.worktreeinclude` により、Git 管理外の `.env` がメイン checkout から自動コピーされます。コピー元の `.env` がない場合、セットアップスクリプトは `.env.example` から作成します。

Codex App で一度だけ **Settings > Local environments** を開き、このプロジェクト用の環境を次の内容で保存してください。以後、この環境を選んで worktree のチャットを作ると setup script が自動実行されます。

- Setup script（Windows / macOS / Linux 共通）: `npm run codex:setup`
- Run action: `npm run dev:worktree`
- Status action: `npm run dev:worktree:status`
- Logs action: `npm run dev:worktree:logs`
- Stop action: `npm run dev:worktree:down`

`Run` は worktree ごとに Compose プロジェクト、ボリューム、PostgreSQL / API / frontend の空きポートを割り当てます。同時起動でポートが先に使われた場合も、別ポートで最大3回再試行します。割り当て結果は Git 管理外の `.worktree-dev.json` に保存されます。

## 必要なもの

- Docker Desktop（Docker Compose v2 を含む）
- Docker を使わず動かす場合は Node.js 22 と PostgreSQL 16

## ローカル開発（推奨）

worktree では、次のコマンドを使うと専用の Compose プロジェクト名・ボリューム・空きポートを自動で割り当てます。割り当てた URL は `.worktree-dev.json` に保存され、同じ worktree では再利用されます。

```bash
npm run dev:worktree
```

起動状態の確認・ログ表示・停止も worktree 単位で行えます。

```bash
npm run dev:worktree:status
npm run dev:worktree:logs
npm run dev:worktree:down
```

通常の固定ポートで起動する場合は、従来どおり次を使います。

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
npm run dev:worktree # worktree専用の空きポートでDocker環境を起動
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
| `OPENAI_API_KEY` | 提案生成と埋め込み作成（未設定時は実データ由来のテンプレート生成） | `sk-...` |
| `OPENAI_TEXT_MODEL` | 提案文生成モデル | `gpt-5-mini` |
| `OPENAI_EMBEDDING_MODEL` | 過去記事との類似度計算用モデル | `text-embedding-3-small` |
| `OPENAI_TIMEOUT_MS` | OpenAI API のタイムアウト（ms） | `300000` |
| `RECOMMENDATION_DATA_SOURCE` | データ取得元（`production_subset` / `auto` / `database`） | `production_subset` |
| `PRODUCTION_SUBSET_DIRECTORY` | production_subset CSVディレクトリ | `database/production_subset/csv` |
| `RECOMMENDATION_STALE_AFTER_DAYS` | 左側の過去記事活用案を優先する最終投稿日からの日数 | `60` |
| `RECOMMENDATION_STORAGE_ENABLED` | 生成結果・履歴・編集内容をPostgreSQLへ保存 | `true` |

OpenAI API キーはバックエンドだけが参照します。フロントエンド用の `VITE_` 変数には入れないでください。初回アクセス時に構造化出力で企画文を生成し、同じ企業・条件の結果は期限なくキャッシュします。提案と生成履歴は `recommendation_generation` テーブルへ永続化され、プロセス再起動後も再利用されます。明示的な再生成操作はキャッシュを使わず、新しい提案を生成します。過去記事・他社事例・提案文は Embedding に変換し、コサイン類似度を使って参考事例の抽出と提案順の決定を行います。類似度は内部評価にのみ使用し、画面には表示しません。

PostgreSQL上の企業IDを指定して、画面アクセス前に提案を生成・表示・キャッシュできます。`--company-id` は必要な社数だけ繰り返せます。企業がPostgreSQLに存在しない、または公開済み配信がない場合は `SKIP` されます。通常は既存キャッシュを表示し、強制的に作り直す場合だけ `--refresh` を付けます。実行時は `RECOMMENDATION_DATA_SOURCE=database` と `RECOMMENDATION_STORAGE_ENABLED=true` が必要です。

```bash
npm run recommendations:prewarm -- --company-id 101 --company-id 202
npm run recommendations:prewarm -- --company-id 101 --refresh
```

EC2/RDS環境ではoperations用コンテナから実行します。

```bash
docker compose --env-file .env.ec2 -f compose.ec2.yaml --profile operations run --rm prewarm-recommendations --company-id 101 --company-id 202
```

EC2/RDS本番環境の全提案キャッシュをクリアする場合は、リポジトリのルートで `./scripts/clear-recommendation-cache-production.sh --yes` を実行します。生成履歴は保持されます。

## データソース

企業情報と過去配信は `RecommendationContextProvider` に集約しています。`production_subset` は抽出CSVを直接参照し、`database` は `PostgresRecommendationContextProvider` が `company`、`release`、`release_statistic`、`release_keyword` などから取得します。データソースを読めない場合は架空データへフォールバックせず、APIエラーとして検出します。

ローカルでは `RECOMMENDATION_DATA_SOURCE=production_subset` を標準とし、CSVを直接参照します。開発DBそのものをCSVへ置き換える必要がある場合だけ、次のコマンドで主キー・外部キーを検証してから置き換えます。

```bash
npm run db:replace-production-subset -- --yes
```

画面が企業IDを指定しない場合、配信件数が多い企業をDBから自動選択します。最終配信から60日以上空いている企業は「01 過去記事活用」、60日未満の企業は「02 新しい切り口」を初期表示します。操作バーの01／02ボタンでいつでも表示を切り替えられます。

01では元記事を選んで企画を1件だけ作り直せます。02は異なる切り口を3件生成し、初期表示の1件から必要に応じて残りを展開できます。分析対象データの最新日時を画面に表示し、AI生成に失敗して簡易提案へ切り替わった場合は再生成導線とともに通知します。

特定企業を確認する場合は `http://localhost:5173/?companyId=<company_id>` のようにURLで企業IDを指定できます。画面の基本レイアウトは変わりません。

## 提案API

- `GET /api/recommendation-companies`: 配信実績のある企業一覧
- `GET /api/recommendations?companyId=<company_id>`: キャッシュ済み提案、または初回生成（省略時はDBから自動選択）
- `POST /api/recommendations/generate`: キャッシュを更新する再生成
- `POST /api/recommendations/regenerate-item`: 01または02の指定した企画1件だけを再生成
- `GET /api/recommendations/history?companyId=<company_id>`: 生成履歴
- `GET /api/recommendations/history/<generation_id>`: 保存した生成結果
- `PUT /api/recommendations/history/<generation_id>`: 編集した企画の保存

画面では生成条件（優先企画、文体、読者、目的、追加情報）の指定、企画編集・保存、履歴復元、元記事リンクの確認ができます。原稿生成やMarkdown・DOCXなどのファイル出力は行いません。

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
