# PR企画レコメンドMVP 実装・運用ガイド

最終確認日: 2026-08-12

この文書は、現在のリポジトリ実装を基準に、短期デモからPostgreSQL/RDS接続までを一貫して説明するものです。READMEとは役割を分け、設計判断、接続手順、受入基準、制約を詳しく記載します。運営から配布された接続情報はリポジトリに含めず、別途安全な経路で管理してください。

> **重要な実装境界**
>
> - デモモードは同梱データをPython上でexact cosine検索します。PostgreSQLモードは、アプリで作ったquery vectorをDBへ送り、`pgvector`でモデル一致・自社除外・未来除外・バケット別exact top-Kを取得します。
> - PostgreSQLから得た意味候補を、Pythonで構造化rerankとMMRへ通します。任意HNSWは現行オンライン経路では意図的に使いません。
> - 成果proxyは参考表示と理由ラベルにだけ使い、類似順位には加算しません。
> - 提供PPTに記載のないURL、ホスト、パスワード、鍵は、この文書でも推測しません。`{{...}}`は運営から受領する値のプレースホルダーです。

## 1. 解決する課題と仮説

### 仮説1: 広報が社内情報を集めるのに時間がかかる

プレスリリースを作る際、広報担当者は「何を発表できるか」「数値や日付は確定しているか」「誰に確認すべきか」を社内の複数部門へ聞く必要があります。本MVPは次の方法で整理コストを下げます。

1. ユーザーが、対象企業、広報目的、発表可能な事実、希望月を先に入力する。
2. 類似する他社事例を、選定理由とともに6件まで示す。
3. 各企画案に、追加で必要な一次情報、確認状態、担当部門のヒント、期限のヒントを付ける。
4. 年間計画の未確定月を「公開予定」と断定せず、社内ネタ収集、一次資料確認、取材・コメント準備、承認・公開条件確認の準備タスクにする。

ただし、現行MVPは社内システム、カレンダー、CRM、チャット、ワークフローには接続しません。情報を自動収集するのではなく、「誰に何を確認するか」を先に構造化する実装です。仮説1の完全な検証には、企画着手から必要情報が揃うまでの時間、確認往復回数、差し戻し回数を導入前後で計測する必要があります。

### 仮説2: インプレッションから改善点や受け取られ方が分からない

本MVPは、`page_view`、`unique_user`、`like_count`、Web掲載件数を参考指標として表示し、同条件に近いコホート内での成果proxy percentileも算出します。これにより、単に文章が似ている事例だけでなく、「参考として反響も確認できる事例」を広報担当者が比較できます。

一方、これらの指標だけでは、好意・批判・誤解などの受け取られ方、閲覧後の行動、売上や採用への因果効果は分かりません。現行MVPは改善仮説を考える材料を提示する段階であり、感情分析、記事論調分析、コンバージョン、A/Bテスト、発信後の学習ループは未実装です。

### 背景課題に対する提供価値

1回プレスリリースを出した後に発信が止まる企業に対し、営業担当者が手作業で紹介していた「他社ではこのような発表種類がある」という提案を、根拠付きで再現します。出力はコピー用の完成原稿ではなく、他社の企画構造を自社の確認済み事実へ変換するための企画案と年間準備計画です。

## 2. ユーザーフロー

1. **条件を入力**: 企業、目的、発表可能な事実、希望月、検索モードを選ぶ。
2. **事例を選ぶ**: 最大6件の他社事例から、企画生成に使う事例を選択する。
3. **ネタを磨く**: 3案のタイトル案、切り口、今出す理由、対象読者、必要な社内情報を確認する。
4. **年間計画**: 指定した開始年月から連続する12か月の公開候補または準備タスクを確認し、BOM付きUTF-8のCSVをダウンロードする。

Web UIの検索モードは次の3つだけです。

| 値 | UI表示 | 返却内容 |
|---|---|---|
| `balanced` | バランス（同業3＋異業種3） | 同業バケット最大3件の後に、異業種バケット最大3件 |
| `same_industry` | 同業事例 | 同業バケット最大3件 |
| `cross_industry` | 異業種ヒント | 異業種バケット最大3件 |

母数が不足する場合は規定件数より少なくなります。

## 3. 類似事例の定義

### 3.1 検索対象データ

提供PPTのER図（スライド2）には15テーブルがあります。現行のPostgreSQLリポジトリは、検索に必要な次の情報を読み取ります。

- `company`、`industry`、`ipo_type`: 企業名、説明、業種、上場区分
- `release`、`release_type`: タイトル、サブタイトル、リード、本文、種別、公開日時
- `release_business_category`、`business_category`: ビジネスカテゴリ
- `release_keyword`、`keyword`: キーワードと優先度
- `release_statistic`: PV、UU、いいね数
- `webclipping_list`: 掲載件数とリリースURL候補

`release_location`、`prefecture`、`city`、`location_category`は提供スキーマに存在しますが、現行の類似スコアには未使用です。リリースの識別子は`release_id`単独ではなく、必ず`company_id:release_id`の複合キーを使います。

`created_at`がNULLのリリースと検索時点より未来のリリースは「投稿済み事例」ではないため除外します。タイムゾーン付き検索時点はAsia/Tokyoへ変換し、提供スキーマのtimestamp without time zoneとJSTの壁時計として比較します。対象企業自身のリリースも推薦結果から除外します。ただし、対象企業の過去の投稿済みリリースは、カテゴリ、キーワード、発表種別を推定するためのアンカーとして利用する場合があります。

### 3.2 ベクトル化するテキスト

検索クエリは次を改行連結します。

- 対象企業名
- 会社説明
- 業種
- 広報目的
- 発表可能な事実
- 希望月

候補リリースは次を連結します。

- タイトル、サブタイトル、リード
- 本文の先頭1,800文字
- 業種、リリース種別、企画パターン
- カテゴリ、キーワード

既定の`HashingEmbedder`は、NFKC正規化とcasefoldを行い、日本語文字1〜4-gramをBLAKE2でfeature hashingする1536次元の決定的なローカルベクトルです。外部通信と追加依存はありませんが、学習済みの意味モデルではなく、語彙・部分文字列の近さを中心に捉える方式です。既定の1536次元は`pr_ai.release_embedding.embedding`の`vector(1536)`と一致します。

`PR_EMBEDDING_PROVIDER=openai`を選ぶと、既定では`text-embedding-3-small`を利用します。PostgreSQLモードでは、Web検索とindexerが同じprovider、モデルID、1536次元を使う必要があります。providerまたはモデルを変えたらindexerを再実行します。

### 3.3 候補抽出と構造化rerank

1. 公開済みメタデータを読み、検索クエリを1回ベクトル化する。
2. デモモードでは、Pythonで候補ベクトルとのexact cosineを計算し、同業・異業種それぞれ上位50件を確保する。
3. PostgreSQLモードでは、query vector、モデルID、対象企業、対象業種、検索時点、バケット、件数をパラメータ化してDBへ送り、`pgvector`の`<=>`でバケット別exact top-K（既定50件）を取得する。SQL側でモデル一致、対象企業自身、公開日時NULL、検索時点より未来のリリースを除外する。
4. PostgreSQLからは候補の複合キー、保存済みベクトル、cosine similarityを受け取る。候補本文をWeb検索のたびに再ベクトル化しない。
5. Pythonで意味類似、業種、カテゴリ、キーワード、発表種別、季節性を再採点する。
6. 同業・異業種の各バケット内でMMRを使って似すぎる結果を減らす。

PostgreSQLの候補SQLは`enable_indexscan`と`enable_bitmapscan`をトランザクション内で無効化し、任意HNSWが存在してもexact評価を行います。`sql/02_pgvector.sql`には再利用可能なexact検索関数もありますが、現行リポジトリは業種バケット条件を含むパラメータ化SQLを直接実行します。

最終類似スコアは次の固定式です。重みの合計は1.00です。

```text
final_score =
    0.55 × semantic_similarity
  + 0.15 × industry_match
  + 0.10 × category_jaccard
  + 0.08 × keyword_jaccard
  + 0.07 × release_type_match
  + 0.05 × seasonality
```

| 要素 | 重み | 定義 |
|---|---:|---|
| 意味類似 | 0.55 | クエリベクトルと候補ベクトルのcosine。0〜1に制限 |
| 業種一致 | 0.15 | 正規化した業種が同じなら1、違えば0 |
| カテゴリ一致 | 0.10 | 正規化したカテゴリ集合のJaccard係数 |
| キーワード一致 | 0.08 | 正規化したキーワード集合のJaccard係数 |
| 発表種別一致 | 0.07 | 推定した発表種別と候補種別が一致すれば1 |
| 季節性 | 0.05 | 月を円環として扱い、`1 - 最短月距離 / 6` |

カテゴリとキーワードのクエリプロファイルは、入力文に現れる既知ラベルと、対象企業の過去リリースのうちクエリに最も近い1件から構成します。発表種別は「調査」「イベント」「採用」「提携」「提供開始」などの語からルール推定し、推定できなければアンカーリリースの種別を使います。

### 3.4 同業バケットと異業種バケット

- `same_industry`: デモでは正規化後の業種が一致する事例。PostgreSQLでは同じ業種マスタ由来の`industry_name`が一致する事例
- `cross_industry`: 上記の業種が一致しない事例。PostgreSQLではNULLも異業種側として扱う

各バケットは独立にMMR選択します。既定の`mmr_lambda`は0.82で、概念上は次の式です。

```text
MMR = 0.82 × final_score
    - 0.18 × 選択済み事例との最大cosine
    - 同一企業が既に選択済みなら0.06
```

このため、最終スコアが高くても、既に選ばれた事例とほぼ同じ内容や同一企業の事例は選ばれにくくなります。`balanced`は全6件を一つの順位へ混ぜるのではなく、同業最大3件、異業種最大3件の順で返します。

### 3.5 選定理由

各結果には、最低でも意味類似の説明と同業・異業種の区分を付けます。該当する場合は、共通カテゴリ、共通キーワード、発表種別一致、公開月の近さ、反響上位を追加し、最大6理由に制限します。

## 4. 成果proxyと限界

成果proxyは次の式で作ります。

```text
outcome_value =
    0.40 × ln(1 + page_view)
  + 0.25 × ln(1 + unique_user)
  + 0.20 × ln(1 + like_count)
  + 0.15 × ln(1 + clipping_count)
```

この値を、次の順で十分な母数が得られるコホートと比較し、percent rankへ変換します。

1. 同業種・同リリース種別・同年
2. 同業種・同リリース種別
3. 同業種
4. 全体

最低3件を目安に条件を緩めます。PV、UU、いいねのいずれかが欠損または負値ならpercentileは算出しません。percentileが0.75以上なら「同条件内で反響上位」という理由を付けられます。

**成果proxyは`final_score`にもMMRにも入りません。** 人気が高いという理由で、内容が似ていない事例を類似上位へ押し上げないためです。UIにも「反響指標は類似順位を左右しない」と明記しています。

成果proxyには次の限界があります。

- 公開からの経過日数、配信規模、企業知名度、広告出稿、タイトル露出量を補正していない。
- PVとUUは関心を示すが、好意的に受け取られたかは示さない。
- いいねと掲載件数は媒体や計測仕様に依存する。
- 小さいコホートでは比較条件を緩めるため、percentileの意味が粗くなる。
- 因果推論ではないため、「この書き方にすれば成果が上がる」とは断定できない。
- コメント、SNS投稿、記事本文の論調や商談・応募コンバージョンを分析していない。

## 5. アーキテクチャ

```mermaid
flowchart LR
    U["広報担当者のブラウザ"] --> W["標準ライブラリHTTPサーバー<br/>静的UI + JSON API"]
    W --> S["ApplicationService"]
    S --> R{"ReleaseRepository"}
    R --> D["同梱の架空データ"]
    R --> P["PostgreSQL / RDS<br/>既存15テーブル + pr_ai"]
    S --> E["SearchEngine"]
    E --> H["既定: ローカルHashingEmbedder"]
    E --> O["任意: OpenAI Embeddings"]
    D --> C["Python exact cosine<br/>バケット別top-K"]
    P --> V["pgvector exact cosine<br/>モデル・自社・未来除外<br/>バケット別top-K"]
    C --> Y["Python<br/>構造化rerank + MMR"]
    V --> Y
    S --> G["3案生成"]
    G --> L["既定: 決定的ローカル生成"]
    G --> X["明示opt-in: OpenAI Responses API<br/>strict JSON Schema / store:false"]
    S --> A["AnnualPlanner<br/>開始年月から12か月"]
    I["差分indexer"] --> V
```

PostgreSQLモードでも、構造化rerank、成果proxy、対象企業の過去リリースによるプロファイル作成に必要なリリースメタデータはアプリへ読み込みます。全件メタデータは既定30秒キャッシュします。一方、意味候補の全件ベクトル化と全件cosineは行わず、DB内の保存済みベクトルから各バケットのexact top-Kだけを取得します。

主要ファイルは次のとおりです。

| ファイル | 役割 |
|---|---|
| `src/pr_recommender/web.py` | `ThreadingHTTPServer`、静的配信、JSON API境界 |
| `web/` | 日本語UI、4ステップ操作、CSV出力 |
| `src/pr_recommender/service.py` | 入力検証、検索・企画・計画の調停、最大128件の企画キャッシュ |
| `src/pr_recommender/repository.py` | 架空データとPostgreSQLの差し替え、pgvector exact候補取得、メタデータキャッシュ |
| `src/pr_recommender/embeddings.py` | ローカルhashingと任意のOpenAI Embeddings |
| `src/pr_recommender/search.py` | デモ/DB候補抽出、固定重みrerank、成果proxy、MMR |
| `src/pr_recommender/generation.py` | 既定のローカル3案生成と、明示opt-inのOpenAI Responses生成 |
| `src/pr_recommender/planner.py` | 12か月計画と未確定月の準備タスク |
| `src/pr_recommender/indexer.py` | 検索用materialized view更新と`pr_ai.release_embedding`への差分投入 |
| `sql/` | 監査、検索用materialized view、pgvector exact検索、任意HNSW |

### 実行モード

`PR_DATA_MODE`は次の3値です。

- `demo`: `PR_DATABASE_URL`があっても同梱の架空データを使う。
- `postgres`: `PR_DATABASE_URL`を必須とし、PostgreSQLを使う。
- `auto`または未設定: `PR_DATABASE_URL`があればPostgreSQL、なければデモ。

主な環境変数は次のとおりです。

| 変数 | 既定/用途 |
|---|---|
| `PR_DATA_MODE` | `auto`。`demo` / `postgres` / `auto` |
| `PR_DATABASE_URL` | PostgreSQL DSN。`postgres`では必須、`auto`では存在時にDBを選択 |
| `PR_DB_CACHE_SECONDS` | PostgreSQLリリースメタデータのプロセス内キャッシュ秒数。既定`30`、`0`で無効 |
| `PR_EMBEDDING_PROVIDER` | `local`。`local` / `openai` |
| `PR_GENERATION_PROVIDER` | `local`。`local` / `openai`。API keyだけではOpenAI生成を有効化しない |
| `OPENAI_API_KEY` | OpenAI EmbeddingsまたはResponsesを明示選択した場合だけ必須 |
| `OPENAI_EMBEDDING_MODEL` | 既定`text-embedding-3-small` |
| `OPENAI_GENERATION_MODEL` | 既定`gpt-4o-mini` |
| `OPENAI_BASE_URL` | 既定`https://api.openai.com/v1`。各クライアントが`/embeddings`または`/responses`を補う |
| `PR_HOST` / `PR_PORT` | Web待受の既定値。`127.0.0.1` / `8765` |

アプリケーションは`.env`を自動読み込みしません。PowerShellの`$env:...`、OSの環境設定、プロセスマネージャー等で値を渡してください。`PR_HOST`と`PR_PORT`はCLI引数を省略したときの既定値であり、`--host`と`--port`を指定すればそちらが優先されます。Docker Composeはプロジェクト直下の`.env`を変数展開に使用します。

## 6. 起動・接続手順

### 6.1 最短: デモモード

前提はPython 3.11以上です。PowerShellでは次の手順で起動できます。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .

$env:PR_DATA_MODE = 'demo'
$env:PR_EMBEDDING_PROVIDER = 'local'
$env:PR_GENERATION_PROVIDER = 'local'
$env:OPENAI_API_KEY = ''
python -m pr_recommender.web --host 127.0.0.1 --port 8765
```

ブラウザで`http://127.0.0.1:8765/`を開きます。デモモードでは架空企業・架空リリースだけを使い、DB、Docker、OpenAI、ネットワーク接続は不要です。

### 6.2 ローカルPostgreSQL + pgvector + pgAdmin

前提はDocker DesktopまたはDocker Engine + Composeです。

#### 1. 秘密値を設定する

Docker Composeは次の既定値でも起動しますが、すべてローカル専用の弱い値です。

- DBユーザー: `hackathon`
- DB名: `prtimes`
- DBパスワード既定値: `hackathon-local-only`
- pgAdminメール既定値: `demo@example.com`
- pgAdminパスワード既定値: `pgadmin-local-only`

共有環境ではプロジェクト直下のGit管理外`.env`に、少なくとも次を設定してください。

```dotenv
POSTGRES_PASSWORD={{STRONG_LOCAL_DB_PASSWORD}}
PGADMIN_DEFAULT_EMAIL={{LOCAL_PGADMIN_EMAIL}}
PGADMIN_DEFAULT_PASSWORD={{STRONG_LOCAL_PGADMIN_PASSWORD}}
```

#### 2. DBとpgAdminを起動する

```powershell
docker compose up -d db
docker compose ps
docker compose --profile tools up -d pgadmin
```

DBはホストの`127.0.0.1:55432`からコンテナの5432番へ転送されます。初回作成時に、`init.sql`、`seed.sql`、`sql/01_search_features.sql`、`sql/02_pgvector.sql`が順に実行されます。`seed.sql`の開発用データはすべて架空です。

pgAdminは`http://127.0.0.1:5050/`です。ログイン後、`Hackathon / PR TIMES Local`が自動登録されます。

| pgAdmin接続項目 | ローカル値 |
|---|---|
| Host | `db` |
| Port | `5432` |
| Maintenance DB | `prtimes` |
| Username | `hackathon` |
| Password | `.env`の`POSTGRES_PASSWORD` |
| SSL mode | `prefer` |

#### 3. 読み取り監査を行う

pgAdminのQuery Toolで`sql/00_preflight.sql`を開いて実行します。確認するのは、接続DB・ユーザー、`vector`拡張の提供状況、主要テーブル件数、タイトル・本文・公開日時の欠損です。このファイルは読み取り専用です。

PowerShellから実行する場合は次の形でも確認できます。

```powershell
Get-Content -Raw .\sql\00_preflight.sql |
  docker compose exec -T db psql -U hackathon -d prtimes
```

#### 4. PostgreSQL用の検索索引を作る

```powershell
python -m pip install -e ".[postgres]"
$env:PR_DATA_MODE = 'postgres'
$env:PR_DATABASE_URL = 'postgresql://hackathon:{{URL_ENCODED_LOCAL_DB_PASSWORD}}@127.0.0.1:55432/prtimes'
$env:PR_EMBEDDING_PROVIDER = 'local'
$env:PR_GENERATION_PROVIDER = 'local'
python -m pr_recommender.indexer --provider local --batch-size 32
```

パスワードに`@`、`:`、`/`、`#`などが含まれる場合はDSN内でURLエンコードしてください。PostgreSQLモードのWeb検索は`pr_ai.release_embedding`を利用するため、indexerは任意ではなく事前準備です。初回は公開済みリリースを1536次元で投入し、2回目以降は検索テキストのSHA-256またはモデルIDが変わった行だけを更新します。二重起動はDBのadvisory lockで防ぎ、外部埋め込み処理を長いDBトランザクションの外へ出し、書き込みはbatchごとの短いトランザクションにします。

Webとindexerのprovider・モデルを必ず揃えてください。モデル一致の埋め込みがない場合、検索APIはindexerの実行を求めるエラーにします。固定列が`vector(1536)`なので、異なる次元のモデルはindexerが拒否します。

#### 5. アプリをPostgreSQLモードで起動する

```powershell
python -m pr_recommender.web --host 127.0.0.1 --port 8765
```

元データを更新した後は、Query Toolで次をトランザクション外から実行し、その後indexerを再実行します。indexer自身も起動時にmaterialized viewを`CONCURRENTLY`更新しますが、手動更新時も同じくトランザクション外で実行します。

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY pr_ai.release_search_features;
```

`sql/03_hnsw_optional.sql`は自動実行されません。現行オンライン候補SQLは正解評価のためHNSWを明示的に使わないので、この索引を作ってもWeb検索経路は変わりません。exact検索のp95を測った後、近似検索の再現率評価とコード変更を行う段階だけ、権限と運用時間を確認して利用します。

### 6.3 提供AWS/RDS環境

提供PPTのスライド1と3から確認できる事実は次のとおりです。

- 各チーム専用AWS環境のVPCがある。
- Public subnetのEC2上にpgAdminがあり、チーム別URLからアクセスする。
- Private subnetにAmazon RDS for PostgreSQLがある。
- 参加者PCは社員Wi-FiまたはゲストWi-Fiから、ブラウザまたはSSHでEC2へ接続する。許可Wi-Fiからのみ接続可能。
- EC2からRDSへPostgreSQLの5432番で接続する。
- DB名は`prtimes`、ユーザーは`hackathon`、ポートは`5432`。
- RDSにはPR TIMESが保有するプレスリリースと関連データが保存されている。
- AWSアカウントはハッカソン期間中のみ利用でき、初期EC2/RDS/VPCの利用・変更・削除や別環境構築は任意。ただし過大なインスタンスは避け、不明点はメンターへ相談する。

PPTに記載がないため、次の値は運営から受領してください。

| 必要値 | プレースホルダー |
|---|---|
| チーム別pgAdmin URL | `{{TEAM_PGADMIN_URL}}` |
| pgAdminログイン情報 | `{{PGADMIN_LOGIN}}` / `{{PGADMIN_PASSWORD}}` |
| RDSエンドポイント | `{{RDS_ENDPOINT}}` |
| DBパスワード | `{{DB_PASSWORD}}` |
| EC2 SSHホスト・ユーザー・鍵 | `{{EC2_SSH_HOST}}` / `{{EC2_SSH_USER}}` / `{{SSH_KEY_PATH}}` |
| SSL要件 | `{{RDS_SSL_MODE_FROM_OPERATIONS}}` |

#### pgAdminで接続する

1. 社員Wi-FiまたはゲストWi-Fiへ接続する。
2. ブラウザで`{{TEAM_PGADMIN_URL}}`を開く。
3. 運営配布のpgAdmin認証情報でログインする。
4. RDSサーバーが未登録の場合、Host=`{{RDS_ENDPOINT}}`、Port=`5432`、Maintenance DB=`prtimes`、Username=`hackathon`、Password=`{{DB_PASSWORD}}`を登録する。
5. SSL modeはPPTから推測せず、`{{RDS_SSL_MODE_FROM_OPERATIONS}}`に従う。
6. Query Toolでまず`sql/00_preflight.sql`を実行する。

RDSはPrivate subnetにあり、PPTには参加者PCからRDSへの直接経路は描かれていません。ローカルPCからRDSへ直接接続できる前提を置かず、アプリをEC2で動かすか、運営が承認したSSHトンネルを利用します。

#### PostgreSQL検索の事前準備

`PR_DATA_MODE=postgres`の現行検索には、`vector`拡張、`pr_ai.release_search_features`、`pr_ai.release_embedding`が必要です。`sql/00_preflight.sql`で`vector`が利用可能か確認し、拡張作成権限と`pr_ai`スキーマ作成方針を運営へ確認してから、`sql/01_search_features.sql`、`sql/02_pgvector.sql`をこの順で実行します。既存15テーブルを変更せず、`pr_ai`配下へ派生オブジェクトを作る設計です。

次に、Webと同じ`PR_DATABASE_URL`、`PR_EMBEDDING_PROVIDER`、`OPENAI_EMBEDDING_MODEL`（OpenAI利用時）を設定したEC2上でindexerを実行します。PPTにはEC2のOSとshellが記載されていないため、次はPOSIX shellの例です。PowerShellの場合は`export NAME=value`を`$env:NAME = 'value'`へ読み替えてください。

```bash
python -m pip install -e ".[postgres]"
export PR_DATABASE_URL='postgresql://hackathon:{{URL_ENCODED_DB_PASSWORD}}@{{RDS_ENDPOINT}}:5432/prtimes?sslmode={{RDS_SSL_MODE_FROM_OPERATIONS}}'
export PR_EMBEDDING_PROVIDER='local'
python -m pr_recommender.indexer --provider local --batch-size 32
```

`vector`が利用できない、派生オブジェクトの作成が承認されない、またはindexerを実行できない場合、PostgreSQLモードは検索できません。Python全件cosineへの自動フォールバックはありません。短期デモは`PR_DATA_MODE=demo`を使うか、運営が承認したpgvector環境を用意してください。ハッカソン中に既存RDSへ無断で拡張、スキーマ、インデックスを作成しないでください。

#### EC2上でアプリを動かす場合

```bash
export PR_DATA_MODE='postgres'
export PR_DATABASE_URL='postgresql://hackathon:{{URL_ENCODED_DB_PASSWORD}}@{{RDS_ENDPOINT}}:5432/prtimes?sslmode={{RDS_SSL_MODE_FROM_OPERATIONS}}'
export PR_EMBEDDING_PROVIDER='local'
export PR_GENERATION_PROVIDER='local'
python -m pr_recommender.web --host 127.0.0.1 --port 8765
```

現行Webサーバーには認証とTLSがないため、インターネットへ直接公開しないでください。許可されたSSH接続がある場合は、例えばローカル8765番をEC2上の127.0.0.1:8765へ転送します。実際のホスト、ユーザー、鍵は運営配布値を使います。

```powershell
ssh -i "{{SSH_KEY_PATH}}" -L 8765:127.0.0.1:8765 "{{EC2_SSH_USER}}@{{EC2_SSH_HOST}}"
```

その後、ローカルブラウザで`http://127.0.0.1:8765/`を開きます。SSHトンネルの利用可否と詳細はメンターへ確認してください。

## 7. OpenAIの任意設定

提供PPTのスライド4では、各チームにOpenAI API Keyを1つ発行し、プロダクトまたはCoding Agentに利用できるとされています。1キーあたり$50の利用上限が設定されていますが、上限到達時はメンターへ相談して引き上げ可能と説明されています。実際のキーはPPT内にはありません。

本MVPはOpenAIなしで完全に動作します。利用する場合は、秘密値をGitへ入れずプロセス環境へ設定します。

企画3案だけをOpenAI Responsesで生成する設定は次のとおりです。

```powershell
$env:OPENAI_API_KEY = '{{OPENAI_API_KEY}}'
$env:PR_GENERATION_PROVIDER = 'openai'
$env:OPENAI_GENERATION_MODEL = 'gpt-4o-mini'
```

挙動は次のとおりです。

- 既定の`PR_GENERATION_PROVIDER=local`は、キーの有無にかかわらず外部通信しない決定的生成を使う。
- `OPENAI_API_KEY`を設定しただけでは企画データを送信しない。`PR_GENERATION_PROVIDER=openai`の明示指定が必要。
- Responses APIの失敗、拒否、タイムアウト、形式不正はローカル生成へフォールバックしない。生成処理を失敗として扱い、Web APIは500、UIはエラー状態を表示する。詳細はサーバーログで確認し、ローカル生成へ戻す場合は明示的に`PR_GENERATION_PROVIDER=local`へ変更する。
- 不正な`PR_GENERATION_PROVIDER`は入力設定エラーになる。
- Responsesリクエストはstrict JSON Schemaを使い、`store:false`を指定する。
- `OPENAI_BASE_URL`の末尾に`/responses`を補い、`OPENAI_GENERATION_MODEL`を利用する。
- アプリは$50上限の監視、使用量表示、キーごとの課金制御を行わない。

OpenAI企画生成では、最大12件の参考リリースから、タイトル、サブタイトル、リード、本文抜粋と安全なメタデータを送信します。ユーザーが入力した発表可能事実も`target_input_claims_unverified`として未検証扱いにします。参考本文を「信頼しないデータ」と明示し、許可された複合キーだけを根拠にできるstrict schemaで検証します。別企業の文章、数値、日付、実績、顧客名を対象企業の事実へ転用することは禁止しています。

検索ベクトルもOpenAIにする場合だけ、別途次を設定します。

```powershell
$env:PR_EMBEDDING_PROVIDER = 'openai'
$env:OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
```

OpenAI Embeddingsも失敗時のローカル自動フォールバックはありません。PostgreSQLモードでは同じ設定で`python -m pr_recommender.indexer --provider openai`を実行し、モデル一致の1536次元索引を事前作成してください。`OPENAI_BASE_URL`にはEmbeddingsも`/embeddings`を補います。企画生成と検索埋め込みは独立に選択できます。

実データを外部APIへ送れるかは、利用規約、社内ポリシー、個人情報・機密情報の有無を確認してから判断してください。

## 8. JSON API

サーバーは追加Webフレームワークを使わず、Python標準の`ThreadingHTTPServer`で静的UIと同一オリジンAPIを提供します。

| Method | Path | 用途 | 主な返却値 |
|---|---|---|---|
| GET | `/api/health` | プロセス疎通 | `ok`, `service`, `version` |
| GET | `/api/bootstrap` | 初期表示 | `mode`, `demo_mode`, `database_enabled`, `openai_enabled`, `generation_provider`, `embedding_provider`, `companies` |
| POST | `/api/search` | 類似事例検索 | `context`, `results` |
| POST | `/api/ideas` | 根拠付き3案生成 | `context`, `results`, `ideas`, `idea_set_id` |
| POST | `/api/plan` | 保存済み企画snapshotから12か月計画 | `context`, `ideas`, `items`, `idea_set_id` |

`openai_enabled`はAPI keyがプロセスに存在するかだけを示します。実際に使う経路は`generation_provider`と`embedding_provider`で確認し、キー存在だけを外部送信の意味にしないでください。

### 共通POST入力

```json
{
  "company_id": 900001,
  "goal": "新サービスの認知獲得",
  "facts": [
    "10月に新機能のβ版を公開できる",
    "利用企業のコメントを取得予定"
  ],
  "desired_month": 10,
  "mode": "balanced"
}
```

- `company_id`: 1以上の整数で、リポジトリに存在する企業。
- `goal`: 必須。前後空白を除き先頭300文字まで。
- `facts`: 必須。配列、改行区切り文字列、または読点区切り文字列。重複を除き最大12件、各300文字まで。
- `desired_month`: 1〜12。
- `mode`: `balanced`、`same_industry`、`cross_industry`。

`/api/ideas`は任意で`selected_release_keys`を受けます。未指定なら現在の検索結果をすべて使い、指定時は1件以上が必要です。

```json
{
  "selected_release_keys": ["900101:1", "900104:2"]
}
```

サーバーは検索を再実行し、その結果に存在するキーだけを採用します。ブラウザから送られたリリース本文やスコアを根拠として信用しません。存在しないキーを1件でも混ぜた場合、または選択結果が0件の場合は400です。生成した企画、検索条件、選択キーをプロセスメモリへsnapshotとして保存し、`idea_set_id`を返します。

`/api/plan`は`/api/ideas`が返した`idea_set_id`と、その企画生成時と同じ共通入力・`selected_release_keys`を必須とします。クライアントが送る企画本文は信用せず、保存済みsnapshotだけから計画を作ります。条件または事例選択を変えた場合は企画を再生成してください。ブラウザUIも選択変更時に既存の企画と計画を無効化します。

```json
{
  "idea_set_id": "{{IDEA_SET_ID_FROM_IDEAS}}",
  "selected_release_keys": ["900101:1", "900104:2"],
  "start_year_month": "2026-08",
  "confirmed_months": []
}
```

- `start_year_month`: 任意の`YYYY-MM`。未指定時はサーバー実行日の年月。ここから連続する12か月を返す。
- `confirmed_months`: 任意の1〜12の月番号配列。配列にある月だけを公開候補にする。未指定または空配列は全12件を`Preparation`にする。
- 現行UIはクライアント側の現在年月を`start_year_month`として送り、`confirmed_months=[]`を送る。このため、希望月は企画の時期ヒントには使うが、公開確定月にはしない。

企画snapshotと`idea_set_id`は最大128件のプロセスメモリ内キャッシュです。サーバー再起動、上限超過、条件・選択変更後は、`/api/ideas`からやり直します。

不正入力はHTTP 400と次の形式で返ります。別originのPOSTは403、JSON以外は415、2MiBを超えるリクエストは413、未知のAPIは404、予期しない内部例外は詳細を隠した500です。

```json
{
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "入力内容を説明する日本語メッセージ"
  }
}
```

## 9. 企画3案と年間計画

### 企画3案

企画生成は必ず3案を返し、各案に次を要求します。

- 企画タイトル案、企画パターン、切り口、今出す理由
- 想定読者
- 必要な一次情報と`provided` / `verify` / `missing`の状態
- 担当部門と期限のヒント
- 根拠となる`company_id:release_id`
- 未確認事項、確度、`Ready`または`Needs facts`

対象企業自身のリリース、検索結果にないキー、根拠キーのない案、必要情報や前提を明示しない案は拒否します。OpenAIを使わない場合も、同じモデルを満たす決定的な3案を生成します。

### 年間計画

年間計画は`start_year_month`から始まる連続12か月を、`year`と`month`付きで返します。例えば`2026-08`開始なら、2026年8月から2027年7月までです。

- `confirmed_months`に入る月だけが公開候補。
- APIで`confirmed_months`を省略した場合と空配列の場合は、全件が`Preparation`。
- 現行UIは`confirmed_months=[]`を送るため、12か月すべてが準備タスク。希望月は企画上の希望・確認事項であり、公開候補へ自動昇格しない。
- それ以外は`Preparation`で、4種類の準備フェーズを循環する。
- 連続する公開候補月は、可能な限り異なる企画パターンにする。
- 異なるパターンを用意できない場合、無理に同じ企画を連続させず準備月へ戻す。
- 希望月や候補月を公開確定日とは断定しない。公開候補を作るのは、API利用者が確認済みの月を`confirmed_months`へ明示した場合だけ。

CSVはブラウザ内で生成し、BOM付きUTF-8とします。年月、企画タイトル、パターン、目的、必要な材料、社内連携先、準備状況、参考リリースを出力し、先頭が`=`, `+`, `-`, `@`のセルにはアポストロフィを加えてCSV数式注入を緩和します。

## 10. 受入基準

### 自動テスト

```powershell
$env:PYTHONPATH = (Resolve-Path .\src).Path
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s tests -v
```

2026-08-12時点で47テストが成功しています。最低限、次を満たすことを受入条件とします。

### 検索

- 固定重みが`0.55 / 0.15 / 0.10 / 0.08 / 0.07 / 0.05`で、合計1.00。
- 対象企業自身、公開日NULL、未来日時のリリースを推薦しない。
- 十分なデモデータでは`balanced`が同業3件と異業種3件を返す。
- `same_industry`と`cross_industry`が片方のバケットだけを返す。
- 各結果に説明理由があり、スコアが0〜1。
- MMRにより同一企業や近すぎる事例へ偏りにくい。
- 成果proxyを`final_score`へ加えない。
- PostgreSQLモードはモデル一致・自社除外・未来除外をSQLで行い、同業/異業種ごとのpgvector exact top-KをPython rerankへ渡す。

### 企画と計画

- 企画はちょうど3案。
- 各案に、検索結果内の複合根拠キーと必要な一次情報がある。
- 他社リリース本文中の命令を指示として扱わず、未確認の他社実績を対象企業の事実へ転用しない。
- 未確認情報は必要情報または前提として明示する。
- OpenAI企画生成は`PR_GENERATION_PROVIDER=openai`の明示指定時だけ行い、キーだけでは送信せず、失敗時にローカル結果へ偽装しない。
- `/api/plan`は有効な`idea_set_id`と一致する条件・選択キーだけを受け、保存済み企画snapshotを使う。
- 年間計画は開始年月から連続12件で年を持ち、UI既定では全件が準備。

### Web/API

- `/api/health`と`/api/bootstrap`が200。
- POST APIがJSONを受け取り、入力不備を400で返す。
- `/`が日本語UIを返し、未知APIが404。
- UIで6事例、選定理由・指標、3案、12か月計画の順に操作できる。
- デモ、接続、ローディング、エラー、空結果を判別できる。
- 検索モードが3値だけで、成果proxyが類似順位に未使用である旨を表示する。
- 年間計画CSVをダウンロードできる。
- 参考事例の選択を変えたら、生成済み企画と年間計画を無効化する。

### PostgreSQL

- `sql/00_preflight.sql`で接続先、件数、欠損、拡張可否を確認できる。
- `company_id, release_id`の複合キーを崩さない。
- `psycopg`がない場合、導入方法を含む明確なエラーになる。
- 1536次元、モデルID、本文ハッシュを保存し、公開済み・変更済み行だけを差分更新できる。
- 同一DBでindexerを二重実行せず、API埋め込み中に長い書き込みトランザクションを保持しない。
- 対応モデルの索引がなければ、Pythonで全件再計算せず明確にindexer実行を求める。

## 11. 短期デモ手順

デモは外部依存を減らすため、`PR_DATA_MODE=demo`、`PR_EMBEDDING_PROVIDER=local`、`PR_GENERATION_PROVIDER=local`を推奨します。OpenAIキーが環境に残っていても、この設定なら外部送信しません。

1. サーバーを起動し、画面右上の「同梱の架空データで動作中」「接続済み」を示す。
2. 対象企業を選び、目的を「新サービスの認知獲得」など具体的に入力する。
3. 発表可能な事実を1行1件で2〜3件入力し、希望月を選ぶ。
4. 「バランス（同業3＋異業種3）」で検索する。
5. 同業3件は実行可能性、異業種3件は企画の型を広げるための枠だと説明する。
6. 選定理由と意味類似を示し、PV等は順位ではなく別の参考信号だと説明する。
7. 参考事例を選び、3案を生成する。
8. 「社内で集める情報」を見せ、仮説1への回答を説明する。
9. 年間計画を生成し、現行UIでは開始年月から12か月すべてが準備タスクであり、希望月も架空の公開予定にはしないと説明する。
10. CSVをダウンロードし、営業・広報の次回会話へ持ち帰れる状態を示す。

トラブル時は次の順で切り分けます。

1. `GET /api/health`が200か。
2. `GET /api/bootstrap`の`mode`が意図した値か。
3. PostgreSQL利用時は`PR_DATABASE_URL`、`psycopg`、`vector`拡張、`pr_ai`派生オブジェクト、WebとindexerのモデルID一致を確認する。索引不足ならindexerを再実行する。
4. OpenAI利用時は`PR_GENERATION_PROVIDER`と`PR_EMBEDDING_PROVIDER`を別々に確認する。切り分け時は両方を`local`へ明示的に戻す。
5. 短期デモ継続が優先なら`PR_DATA_MODE=demo`へ固定する。

## 12. セキュリティ

現行実装で行っていること:

- 静的ファイル配信で解決後パスを静的ルート配下に制限し、パストラバーサルを防ぐ。
- JSONリクエストを2MiBに制限する。
- POST APIは`application/json`を要求し、`Origin`がある場合は同一オリジンだけを許可する。
- DBクエリは`psycopg`のパラメータバインドを使う。
- CSP、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`を返す。
- 予期しないAPI例外の詳細をブラウザへ返さない。
- 企画生成で参考本文を信頼しないデータとして区分し、strict JSON Schemaと許可根拠キーで検証する。
- OpenAI企画生成は明示opt-inだけで行い、Responsesリクエストに`store:false`を設定する。
- 年間計画はサーバー側の企画snapshotを参照し、ブラウザから送られた企画本文を信用しない。
- CSV数式注入を緩和する。

運用上必須の注意:

- `OPENAI_API_KEY`、DBパスワード、SSH鍵をGit、スクリーンショット、共有チャット、プレスリリース本文へ入れない。
- DSNをログや画面に表示しない。
- 現行Webサーバーには認証、ユーザー権限、TLS、レート制限、監査ログ、CSRFトークンがない。原則`127.0.0.1`へbindする。
- ネットワーク公開が必要なら、認証・TLS・アクセス制限を持つ承認済みリバースプロキシの後ろに置く。
- Web実行用とindexer/DDL実行用のDB権限を分ける。Webのリポジトリ経路はSELECTだけだが、indexerは`pr_ai.release_embedding`へ書き込み、SQLファイルは派生オブジェクトを作成する。提供ユーザー`hackathon`の実権限は運営へ確認する。
- `init.sql`と`sql/01`〜`03`はDBを変更する。ローカル以外では、対象、権限、実行時間、ロールバック方針を確認してから明示的に実行する。
- OpenAIを利用する前に、送信される発表可能事実と参考本文が外部APIへ送信可能か確認する。
- プロンプトインジェクション対策はリスクを下げるもので、最終的な事実確認・法務確認・公開承認を代替しない。

## 13. 既知の制約

- ローカルhashingは学習済み意味モデルではなく、同義語や抽象的な越境類似を十分に捉えない場合がある。
- PostgreSQLモードは意味候補をpgvectorで絞る一方、構造化rerankと成果proxy用のリリースメタデータは全件を読み、既定30秒キャッシュする。データ量が大きい場合は初回・更新時の転送量、集計時間、メモリを測る必要がある。
- PostgreSQLの候補取得はバケットごとにexact上位50件であり、オンラインSQLは索引走査を無効化する。データ量が増えるとp95が悪化し得る。任意HNSWは用意されているが、現行Web経路では使わない。
- PostgreSQLモードはpgvector派生オブジェクトと、Webと同じモデルIDの事前索引を必須とし、Python全件cosineへ自動フォールバックしない。
- 埋め込みキャッシュ、企画キャッシュ、企画snapshotはプロセスメモリ内だけで、再起動すると失われる。企画キャッシュとsnapshotは各最大128件で、複数プロセス間では共有しない。
- 季節性は月だけを見ており、祝日、曜日、業界イベント、年度、リードタイムは考慮しない。
- 地域テーブルは類似スコアに未使用。
- 成果proxyは受け取られ方、改善因果、コンバージョンを示さない。
- UIは`confirmed_months`を編集できず、常に空配列を送るため全12か月が準備になる。公開候補月を設定するにはAPIを直接利用する必要がある。
- UIの`start_year_month`はブラウザの`Date.toISOString()`から作るため、UTCとローカル月がずれる時刻では意図した開始月か確認が必要。
- 連続公開月のパターン重複回避は現行実装では月番号の連続を見ており、12月から1月への年跨ぎを隣接扱いしない。
- 年間計画はカレンダーやタスク管理へ同期しない。
- 社内情報を自動取得せず、ユーザー入力と確認タスクの整理に依存する。
- OpenAI企画生成・Embeddingsはいずれも失敗時のローカル自動フォールバックがない。意図しないローカル成功に見せない代わりに、外部API障害時は明示的な設定変更が必要。
- 静的Webサーバーは開発・デモ用途であり、本番向けの認証・可用性・監視を備えない。
- 同梱DBデータとデモデータは架空であり、実際のPR TIMES成果を示すものではない。

## 14. 次に深掘りする機能

短期デモ後は、次の順で進めると仮説検証と技術投資を分離できます。

1. **計測**: 企画決定時間、社内確認往復数、採用された企画、公開までの日数を記録する。
2. **フィードバック**: 提案の採用・却下理由、編集内容、公開後指標を複合キーで保存する。
3. **検索評価**: 広報・営業が作った正例/負例でPrecision@6、バケット別採用率、多様性を評価し、重みを調整する。
4. **DB検索評価**: 接続済みのpgvector exact検索について、バケット別Recall@50、p50/p95、メタデータ転送量を測る。HNSWは近似再現率と運用コストを確認し、明示的なオンライン経路変更として判断する。
5. **反響分析**: 経過日数・企業規模・配信条件を補正し、記事論調やコンバージョンを別信号として追加する。
6. **社内情報収集**: 必要情報の担当者通知、確認状態、一次資料リンク、承認履歴をワークフロー化する。
7. **計画運用**: 複数確定月、責任者、期限、カレンダー連携、実績との差分を扱う。

これらを追加しても、「他社事例は企画構造の参考であり、対象企業の事実ではない」「成果proxyと類似を混ぜない」「未確認日付を公開予定と断定しない」という3原則は維持します。
