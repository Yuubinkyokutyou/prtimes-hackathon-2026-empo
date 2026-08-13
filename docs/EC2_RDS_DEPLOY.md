# EC2 + RDS デプロイ手順

Amazon Linux 2023 の EC2 で本アプリを Docker Compose により起動し、同じ VPC 内の Amazon RDS for PostgreSQL に接続するまでの手順です。

この手順はハッカソンで早く動作確認するための簡易構成です。DB 通信は TLS で暗号化しますが、RDS サーバー証明書の検証は省略します。本番運用へ移す場合は、末尾の「本番化するときの追加項目」を実施してください。

## 完成構成

```text
ブラウザ
  │ HTTP:80（将来は HTTPS:443）
  ▼
EC2 / frontend（Nginx）
  ├─ /      → React の静的ファイル
  └─ /api/* → backend:3000（Docker 内部通信）
                         │ PostgreSQL:5432 / TLS
                         ▼
                    RDS PostgreSQL
```

- EC2 と RDS は同じ VPC に置きます。
- RDS はパブリックアクセスを無効にします。
- RDS の 5432 番ポートは、EC2 に付けたセキュリティグループからだけ許可します。
- EC2 上に PostgreSQL コンテナは起動しません。`compose.ec2.yaml` は frontend と backend だけを起動します。

## 0. 事前に決める値

以降のプレースホルダーを自分の値に置き換えます。

| 項目 | 記入例 |
| --- | --- |
| AWS リージョン | `ap-northeast-1` |
| VPC | EC2 と RDS で同じ VPC |
| DB 名 | `team_empo` |
| DB ユーザー | `app_user` |
| RDS エンドポイント | `xxxxx.ap-northeast-1.rds.amazonaws.com` |
| アプリの公開先 | `http://<EC2_PUBLIC_IP>` または `https://example.com` |
| リポジトリ URL | `<REPOSITORY_URL>` |

DB パスワードを Git、README、シェル履歴へ書き込まないでください。`DATABASE_URL` に `@`、`:`, `/`, `?`, `#`, `%` などを含むユーザー名・パスワードを入れる場合は、その部分を URL エンコードする必要があります。

## 1. セキュリティグループを作る

### EC2 用セキュリティグループ

例: `team-empo-ec2-sg`

| 方向 | 種別 | ポート | 接続元 |
| --- | --- | --- | --- |
| インバウンド | HTTP | 80 | `0.0.0.0/0`、必要なら `::/0` |
| インバウンド | SSH | 22 | 自分のグローバル IP `/32` のみ |
| アウトバウンド | All traffic | All | デフォルトのまま |

Session Manager で接続する場合、SSH 22 のルールは不要です。HTTPS 化するときは 443 を追加します。

### RDS 用セキュリティグループ

例: `team-empo-rds-sg`

| 方向 | 種別 | ポート | 接続元 |
| --- | --- | --- | --- |
| インバウンド | PostgreSQL | 5432 | `team-empo-ec2-sg` |

接続元には IP アドレスではなく、EC2 用セキュリティグループそのものを指定します。RDS の 5432 を `0.0.0.0/0` に公開しないでください。

## 2. RDS for PostgreSQL を作る

AWS コンソールの **RDS → データベースの作成** で次のように設定します。

- エンジン: PostgreSQL
- バージョン: PostgreSQL 16 系（ローカル環境と同じメジャーバージョン）
- テンプレート: 開発・検証なら無料利用枠または開発/テスト、本番なら要件に合わせる
- DB インスタンス識別子: 例 `team-empo-db`
- マスターユーザー名: 例 `app_user`
- 認証情報: 強いパスワード。可能なら Secrets Manager で管理
- 接続: EC2 と同じ VPC
- パブリックアクセス: **なし**
- VPC セキュリティグループ: `team-empo-rds-sg`
- ポート: `5432`
- 追加設定 → 最初のデータベース名: `team_empo`
- 削除保護、バックアップ保持期間、Multi-AZ: 環境の重要度に合わせて設定

作成完了後、RDS の **接続とセキュリティ** からエンドポイントを控えます。エンドポイントに `:5432` は含めません。

既存の EC2 と RDS を使う場合は、RDS の **アクション → EC2 接続をセットアップ** でもセキュリティグループを自動設定できます。同じ VPC にあることが前提です。

## 3. EC2 を作る

AWS コンソールの **EC2 → インスタンスを起動** で次のように設定します。

- AMI: 最新の Amazon Linux 2023
- アーキテクチャ: `x86_64`
- インスタンスタイプ: ビルド時の余裕を考え、まずは `t3.small` 相当を推奨
- ストレージ: gp3 20 GiB 以上を目安
- VPC: RDS と同じ VPC
- サブネット: インターネットから直接公開する構成ではパブリックサブネット
- パブリック IP: 有効。固定公開するなら Elastic IP を関連付ける
- セキュリティグループ: `team-empo-ec2-sg`
- 接続方法: SSH キーペア、または IAM ロールを付けて Session Manager

EC2 と RDS を別の Availability Zone に置くと、クロス AZ のデータ転送料が発生する場合があります。

## 4. EC2 に接続して Docker を入れる

SSH の例です。Session Manager の場合は AWS コンソールからシェルを開きます。

```bash
ssh -i /path/to/key.pem ec2-user@<EC2_PUBLIC_IP>
```

Amazon Linux 2023 で実行します。

```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
```

いったんログアウトして再接続し、グループ設定を反映します。

```bash
exit
ssh -i /path/to/key.pem ec2-user@<EC2_PUBLIC_IP>
docker info
```

Docker Compose プラグインを入れます。

```bash
sudo dnf install -y docker-compose-plugin
docker compose version
```

`docker-compose-plugin` が利用中のリポジトリにない場合は、Docker 公式手順の「Install manually」に従って Compose プラグインを導入してください。旧式の `docker-compose` コマンドではなく、`docker compose` を使います。

手動導入する場合の例です。`COMPOSE_VERSION` は Docker 公式ページに掲載されている現行バージョンへ置き換えます。

```bash
COMPOSE_VERSION=v5.4.0
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL \
  "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
```

## 5. アプリを配置する

```bash
git clone <REPOSITORY_URL>
cd PR_TIMES_HACK_2026
```

非公開リポジトリの場合は、読み取り専用の deploy key や GitHub App など、チームの認証方式を使います。

## 6. EC2 から既存の分析用RDSを確認する

まず `psql` の Docker イメージを使って接続を確認します。パスワードはプロンプトで入力します。

```bash
docker run --rm -it \
  postgres:16-alpine \
  psql "host=<RDS_ENDPOINT> port=5432 dbname=team_empo user=app_user sslmode=require" \
  -W -c "SELECT
    current_database(),
    current_user,
    version(),
    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl;"
```

本番由来の分析テーブルが存在することを確認します。

```bash
docker run --rm -it \
  postgres:16-alpine \
  psql "host=<RDS_ENDPOINT> port=5432 dbname=team_empo user=app_user sslmode=require" \
  -W -c "\dt public.*"
```

主要な分析テーブルにデータがあるかを、全件集計せず確認します。

```bash
docker run --rm -it \
  postgres:16-alpine \
  psql "host=<RDS_ENDPOINT> port=5432 dbname=team_empo user=app_user sslmode=require" \
  -W -c "SELECT
    EXISTS (SELECT 1 FROM public.company) AS has_companies,
    EXISTS (SELECT 1 FROM public.release) AS has_releases,
    EXISTS (SELECT 1 FROM public.release_statistic) AS has_statistics;"
```

ルートの `init.sql` は本番由来の分析テーブルをローカル開発DBへ再現する用途です。本番RDSには適用しません。上記テーブルがない場合は、利用するRDSまたはDB名が正しいかを確認してください。

## 7. 本番用環境変数を設定する

```bash
cp .env.ec2.example .env.ec2
chmod 600 .env.ec2
vi .env.ec2
```

例です。実際の認証情報と公開 URL に置き換えます。

```dotenv
DATABASE_URL=postgresql://app_user:<URL_ENCODED_PASSWORD>@<RDS_ENDPOINT>:5432/team_empo
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false
CORS_ORIGIN=http://<EC2_PUBLIC_IP>
WEB_PORT=80
OPENAI_API_KEY=
RECOMMENDATION_DATA_SOURCE=database
```

- `DATABASE_SSL=true` で通信を暗号化します。
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false` は、CA 証明書を準備せず動かすためのハッカソン向け設定です。
- `CORS_ORIGIN` は末尾の `/` を付けず、ブラウザで開く Origin と完全一致させます。ドメインと HTTPS を導入したら `https://example.com` に変更します。
- `RECOMMENDATION_DATA_SOURCE=database` にすると、推薦ダッシュボードもRDS上の分析テーブルを参照します。本番では `production_subset` を指定しません。
- `OPENAI_API_KEY` は任意です。空の場合でも、RDSの分析データに基づくデモ提案を表示できます。
- `.env.ec2` は `.gitignore` 対象です。コミットしないでください。
- 長期運用では平文ファイルではなく、Secrets Manager または Systems Manager Parameter Store から起動時に渡してください。

設定ファイルの形式だけを検証します。`--quiet` を付けることで、解決済みのパスワードを画面に表示しません。

```bash
docker compose --env-file .env.ec2 -f compose.ec2.yaml config --quiet
```

## 8. 起動して RDS 接続を確認する

`up` を実行すると、最初に `migrate` サービスが `migrations/*.sql` の未適用分だけをRDSへ適用します。マイグレーションが失敗した場合、backendは起動しません。

```bash
docker compose --env-file .env.ec2 -f compose.ec2.yaml up -d --build
docker compose --env-file .env.ec2 -f compose.ec2.yaml ps
```

`migrate` が `Exited (0)`、frontendとbackendが起動状態になっていることを確認します。マイグレーションのログと適用履歴は次のコマンドで確認できます。

```bash
docker compose --env-file .env.ec2 -f compose.ec2.yaml logs migrate

docker run --rm -it \
  postgres:16-alpine \
  psql "host=<RDS_ENDPOINT> port=5432 dbname=team_empo user=app_user sslmode=require" \
  -W -c "SELECT version, applied_at FROM app_migrations.schema_migration ORDER BY version;"
```

EC2 内からアプリと DB のヘルスチェックを実行します。

```bash
curl -fsS http://localhost/api/health
curl -fsS http://localhost/api/health/db
curl -fsS "http://localhost/api/releases?limit=1"
curl -fsS http://localhost/api/recommendation-companies
```

期待する結果です。

```json
{"status":"ok"}
{"status":"ok","database":"connected"}
{"items":[],"limit":1,"offset":0}
{"items":[]}
```

`/api/health/db` は `SELECT 1` による接続確認です。`/api/releases` と `/api/recommendation-companies` がHTTP 200を返せば、backendと推薦機能がRDS上の `public.release`、`public.company`、`public.industry`、`public.release_statistic` などを実際に参照できています。分析データが0件の場合、`items` が空配列でも正常です。

ブラウザで `http://<EC2_PUBLIC_IP>/` を開きます。ここまで成功すれば、EC2 上のアプリからRDSを利用できています。

アプリ固有テーブルを追加するときは、既存のマイグレーションを編集せず `migrations/002_...sql` のように新しいファイルを追加します。詳しくは [アプリ用データベースマイグレーション](DATABASE_MIGRATIONS.md) を参照してください。

## 更新時

```bash
cd ~/PR_TIMES_HACK_2026
git pull --ff-only
docker compose --env-file .env.ec2 -f compose.ec2.yaml up -d --build
docker compose --env-file .env.ec2 -f compose.ec2.yaml ps
curl -fsS http://localhost/api/health/db
```

`up` の中でアプリ用マイグレーションが先に適用されます。分析テーブルの更新や再作成はこのデプロイ処理では行いません。

## ログと停止

```bash
# 全サービスの直近ログ
docker compose --env-file .env.ec2 -f compose.ec2.yaml logs --tail=200

# backend のログを追う
docker compose --env-file .env.ec2 -f compose.ec2.yaml logs -f backend

# 停止
docker compose --env-file .env.ec2 -f compose.ec2.yaml down
```

## よくあるエラー

### `connect ETIMEDOUT` / `Connection timed out`

- EC2 と RDS が同じ VPC か確認する。
- RDS 用 SG の 5432 インバウンド接続元が EC2 用 SG か確認する。
- EC2 に想定した SG が実際に付いているか確認する。
- `DATABASE_URL` の RDS エンドポイントとポートを確認する。

### `password authentication failed`

- DB ユーザー名とパスワードを確認する。
- パスワードの予約文字が URL エンコードされているか確認する。
- `.env.ec2` の値を引用符で囲んでいないか、余計な空白がないか確認する。

### `database "team_empo" does not exist`

RDS 作成時の「最初のデータベース名」が未設定です。管理ユーザーで `postgres` DB に接続して `team_empo` を作るか、RDS を正しい初期 DB 名で作り直します。

### `no pg_hba.conf entry ... SSL off`

`.env.ec2` の `DATABASE_SSL=true` を確認し、backend を再作成してください。

```bash
docker compose --env-file .env.ec2 -f compose.ec2.yaml up -d --force-recreate backend
```

### EC2 の外から画面を開けない

- EC2 用 SG が HTTP 80 を許可しているか確認する。
- `docker compose ... ps` で frontend が `0.0.0.0:80->80/tcp` になっているか確認する。
- EC2 にパブリック IPv4 または Elastic IP があるか確認する。
- `WEB_PORT` を変更している場合は、SG 側も同じポートを許可する。

### backend が unhealthy

```bash
docker compose --env-file .env.ec2 -f compose.ec2.yaml logs --tail=200 backend
```

環境変数エラー、DB 接続エラー、TLS 設定エラーの順に確認します。

### migrate が失敗する

```bash
docker compose --env-file .env.ec2 -f compose.ec2.yaml logs --tail=200 migrate
```

- DBユーザーにスキーマ・テーブルを作成する権限があるか確認する。
- 適用済みの `migrations/*.sql` を編集していないか確認する。
- 分析テーブルへの外部キーを追加した場合、参照先の `public` テーブルが存在するか確認する。
- SQLを修正するときは適用済みファイルを書き換えず、新しい番号のマイグレーションを追加する。

## 本番化するときの追加項目

- Route 53 などでドメインを設定する。
- ALB + ACM、または EC2 上の HTTPS 対応リバースプロキシで TLS 終端する。
- EC2 の 22 番を閉じ、Session Manager を使う。
- RDS の自動バックアップ、削除保護、必要に応じて Multi-AZ を有効にする。
- `.env.ec2` の DB 認証情報を Secrets Manager / Parameter Store に移す。
- AWS の RDS CA バンドルを backend に渡し、`DATABASE_SSL_REJECT_UNAUTHORIZED=true` にして証明書を検証する。
- CloudWatch Logs、メトリクス、アラームを設定する。
- OS、Docker、Compose、コンテナイメージを定期更新する。

## 参考（公式ドキュメント）

- [AWS: Amazon Linux 2023 に Docker をインストール](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/create-container-image.html)
- [AWS: EC2 と RDS の接続を自動設定](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/ec2-rds-connect.html)
- [AWS: RDS for PostgreSQL の SSL/TLS 接続](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)
- [Docker: Compose プラグインのインストール](https://docs.docker.com/compose/install/linux/)
