import { z } from 'zod';
import { config } from './config.js';
import {
  CompanyNotFoundError,
  PostgresRecommendationContextProvider,
} from './recommendationRepository.js';
import { ProductionSubsetRecommendationContextProvider } from './productionSubsetRecommendationRepository.js';
import type {
  CompanySummary,
  ExistingSuggestion,
  NewOpportunity,
  PastRelease,
  RecommendationContext,
  RecommendationContextProvider,
  RecommendationDashboard,
  SimilarRelease,
} from './recommendationTypes.js';

export type {
  CompanyProfile,
  CompanySummary,
  ExistingSuggestion,
  NewOpportunity,
  RecommendationDashboard,
} from './recommendationTypes.js';

// Replace this provider with a PostgreSQL implementation when real company data is ready.
// The generation and UI contracts can stay unchanged.
const mockContextProvider: RecommendationContextProvider = {
  async get(companyId: string) {
    if (companyId !== '900001') throw new CompanyNotFoundError(companyId);
    return {
      company: {
        id: '900001',
        name: '株式会社デモ青空',
        initials: '青',
        industry: '情報通信業',
        location: '東京都渋谷区',
        founded: '2018年',
        capital: '5,000万円',
        website: 'https://aozora.example',
        description: 'AIとデータを活用した架空の業務支援サービスを開発するデモ企業です。',
      },
      pastReleases: [
        {
          id: '1',
          genre: '商品サービス',
          title: '【架空サービス】広報AIアシスタント「SoraPress」β版を提供開始',
          summary: 'プレスリリース作成から効果測定までを一つの画面で支援。',
          body: '企画メモを基にプレスリリースの構成案を作成し、公開後の反響を確認できるデモサービスです。',
          publishedAt: '2026-08-12T09:00:00.000Z',
          pageView: 128450,
          likeCount: 3120,
          keywords: ['AI', 'DX', '新商品'],
        },
        {
          id: '2',
          genre: 'イベント',
          title: '全国の広報担当者向け「デモPR勉強会2026」を東京・オンラインで開催',
          summary: '実践ワークショップと交流会を同時開催。',
          body: '会場参加とオンライン参加を選べるハイブリッド形式で、架空事例を使ったワークショップを実施します。',
          publishedAt: '2026-07-20T14:30:00.000Z',
          pageView: 8450,
          likeCount: 210,
          keywords: ['イベント', '教育', 'AI'],
        },
        {
          id: '3',
          genre: '調査レポート',
          title: '生成AIの広報活用に関する実態調査2026、担当者の72％が業務効率化を実感',
          summary: '架空の広報担当者400名を対象にしたデモ調査。',
          body: '文章の下書き、情報収集、効果測定の順で利用が多いという架空の結果です。',
          publishedAt: '2026-06-30T10:00:00.000Z',
          pageView: 35680,
          likeCount: 780,
          keywords: ['調査', 'AI', 'DX'],
        },
        {
          id: '4',
          genre: '経営情報',
          title: '株式会社デモ青空、事業拡大に向けた架空の資金調達を実施',
          summary: '開発・採用・地域展開を強化。',
          body: '調達したという設定の資金は、プロダクト開発、採用、カスタマーサポートの強化に充当します。',
          publishedAt: '2026-05-15T15:00:00.000Z',
          pageView: 15020,
          likeCount: 402,
          keywords: ['資金調達', 'スタートアップ', '採用'],
        },
        {
          genre: '商品サービス',
          title: '広報AIアシスタント「SoraPress」に他社事例から企画案を提案する機能を追加',
          summary: '過去の発信テーマと広報効果測定を基に次の一手を提示。',
          body: '投稿済みの内容から目的と対象読者を抽出し、類似した他社事例や別の切り口を表示します。',
          id: '5',
          publishedAt: '2026-08-12T16:30:00.000Z',
          pageView: 0,
          likeCount: 0,
          keywords: ['広報DX', 'プレスリリース作成', '広報効果測定'],
        },
      ],
      candidateReleases: [],
    };
  },
  async listCompanies() {
    return [
      {
        id: '900001',
        name: '株式会社デモ青空',
        initials: '青',
        industry: '情報通信業',
        releaseCount: 5,
      },
    ];
  },
};

const postgresContextProvider = new PostgresRecommendationContextProvider();
const productionSubsetContextProvider = new ProductionSubsetRecommendationContextProvider();

const demoSuggestions: ExistingSuggestion[] = [
  {
    id: 'sorapress-origin',
    genre: '開発秘話',
    eyebrow: '過去記事 × 開発ストーリー',
    title: '企画メモが記事になるまで。広報AI「SoraPress」β版を支えた試行錯誤',
    summary:
      '機能紹介だけでは見えなかった、企画メモから構成案を生み出すまでの改善過程を開発チームの言葉でたどります。',
    whyNow: 'β版提供開始の記事は12万PVを超えており、読者の関心を開発の背景へ広げやすいタイミングです。',
    contentOutline: [
      '広報担当者の「何から書けばいい？」が出発点',
      '企画メモを構成案へ変えるまでの検証',
      '効果測定まで一つの画面に込めた理由',
    ],
    sourceTitle: '【架空サービス】広報AIアシスタント「SoraPress」β版を提供開始',
    sourceReleaseId: '1',
    similarity: 95,
  },
  {
    id: 'workshop-voices',
    genre: 'イベントレポート',
    eyebrow: '過去記事 × 参加者の声',
    title: '「広報ネタがない」が変わった日。デモPR勉強会2026の学びと対話',
    summary:
      '開催告知を参加者視点のレポートへ展開。実践ワークショップで生まれた気づきや担当者同士の対話を次回開催につなげます。',
    whyNow: '告知だけで終わらせず、参加価値を具体化することで次回イベントやコミュニティ形成に活用できます。',
    contentOutline: [
      '参加者が抱えていた発信の悩み',
      '架空事例ワークで見つけた自社の切り口',
      '勉強会の先に育てたい広報担当者のつながり',
    ],
    sourceTitle: '全国の広報担当者向け「デモPR勉強会2026」を東京・オンラインで開催',
    sourceReleaseId: '2',
    similarity: 90,
  },
  {
    id: 'survey-insight',
    genre: '調査インサイト',
    eyebrow: '過去記事 × データ解説',
    title: '72％の「効率化実感」、その先へ。400人調査から読む広報AIの現在地',
    summary:
      '調査結果の発表から一歩進み、文章作成・情報収集・効果測定で生成AIがどう使い分けられているかを解説します。',
    whyNow: '3.5万PVの調査結果を実務目線で読み直し、継続的に参照される解説コンテンツへ発展できます。',
    contentOutline: ['72％が実感した効率化の内訳', '活用が進む業務・進まない業務', '広報担当者が次に備えること'],
    sourceTitle: '生成AIの広報活用に関する実態調査2026、担当者の72％が業務効率化を実感',
    sourceReleaseId: '3',
    similarity: 92,
  },
  {
    id: 'growth-vision',
    genre: '経営・ビジョン',
    eyebrow: '過去記事 × これからの会社',
    title: '資金調達のその先へ。デモ青空が描く「すべての企業に広報の力を」',
    summary:
      '調達額の発表ではなく、開発・採用・地域展開を通じて解決したい広報課題と今後の意思を代表者の言葉で伝えます。',
    whyNow: '資金調達記事に書かれた三つの投資領域を、顧客と社会にとっての価値へ言い換えられます。',
    contentOutline: ['創業時に感じた中小企業の広報課題', '開発・採用・地域展開に投資する理由', '5年後に実現したい広報のあり方'],
    sourceTitle: '株式会社デモ青空、事業拡大に向けた架空の資金調達を実施',
    sourceReleaseId: '4',
    similarity: 84,
  },
];

const demoNewOpportunity: NewOpportunity = {
  id: 'customer-success',
  genre: '導入企業・伴走支援',
  eyebrow: 'まだ発信していない魅力',
  title: 'AIを入れて終わりにしない。広報担当者の「最初の1本」に伴走する人たち',
  summary:
    'SoraPressの機能ではなく、導入企業が自社の魅力を見つけ、最初の発信を形にするまでのサポートを主役にした企画です。',
  opportunityReason:
    'seed.sqlの過去5本は、サービス・イベント・調査・資金調達が中心。カスタマーサポートへの投資は示されていますが、顧客に伴走する人やプロセスはまだ発信されていません。',
  pitch:
    'プレスリリースを書いた経験がない担当者は、AIがあっても自社の何を伝えるべきか迷います。デモ青空の伴走チームは、答えを代わりに書くのではなく、担当者との対話から発信の種を見つけます。最初の企画メモが一本の記事になるまでを、導入企業と担当者の両方の視点から紹介します。',
  contentOutline: [
    'きっかけ｜AIがあっても書き始められない担当者の声',
    '伴走｜対話から企業らしい発信テーマを見つけるまで',
    '変化｜最初の一本が社内の情報共有を変える',
    'これから｜地域や業種を越えて広報の選択肢を広げる',
  ],
  interviewQuestions: [
    '導入直後、担当者が最も迷っていたことは何ですか？',
    'AIではなく人が伴走する価値はどこにありますか？',
    '最初の一本を出した後、社内にどんな変化がありましたか？',
  ],
};

type LoadedContext = {
  context: RecommendationContext;
  dataSource: 'production_subset' | 'database' | 'mock';
};

export type PostingCadence = {
  daysSinceLastPublished: number | null;
  recommendedFocus: 'existing' | 'new';
};

export function classifyPostingCadence(
  releases: Pick<PastRelease, 'publishedAt'>[],
  staleAfterDays = config.RECOMMENDATION_STALE_AFTER_DAYS,
  now = Date.now(),
): PostingCadence {
  const timestamps = releases
    .map((release) => Date.parse(release.publishedAt))
    .filter(Number.isFinite);
  if (timestamps.length === 0) {
    return { daysSinceLastPublished: null, recommendedFocus: 'existing' };
  }

  const latestTimestamp = Math.max(...timestamps);
  const daysSinceLastPublished = Math.max(
    0,
    Math.floor((now - latestTimestamp) / 86_400_000),
  );
  return {
    daysSinceLastPublished,
    recommendedFocus: daysSinceLastPublished >= staleAfterDays ? 'existing' : 'new',
  };
}

let databaseFallbackLogged = false;

async function loadContext(companyId: string): Promise<LoadedContext> {
  const useMock = config.NODE_ENV === 'test' || config.RECOMMENDATION_DATA_SOURCE === 'mock';
  if (useMock) return { context: await mockContextProvider.get(companyId), dataSource: 'mock' };

  if (
    config.RECOMMENDATION_DATA_SOURCE === 'production_subset' ||
    config.RECOMMENDATION_DATA_SOURCE === 'auto'
  ) {
    try {
      return {
        context: await productionSubsetContextProvider.get(companyId),
        dataSource: 'production_subset',
      };
    } catch (error) {
      if (
        config.RECOMMENDATION_DATA_SOURCE === 'production_subset' ||
        error instanceof CompanyNotFoundError
      ) {
        throw error;
      }
    }
  }

  try {
    return { context: await postgresContextProvider.get(companyId), dataSource: 'database' };
  } catch (error) {
    const canUseSeedFallback =
      config.RECOMMENDATION_DATA_SOURCE === 'auto' && companyId === '900001';
    if (
      config.RECOMMENDATION_DATA_SOURCE === 'database' ||
      (error instanceof CompanyNotFoundError && !canUseSeedFallback)
    ) {
      throw error;
    }
    if (!databaseFallbackLogged) {
      console.warn('Recommendation database is unavailable; using seed-compatible mock data.');
      databaseFallbackLogged = true;
    }
    return { context: await mockContextProvider.get(companyId), dataSource: 'mock' };
  }
}

function relativePublishedAt(releases: PastRelease[]): string {
  const latestTimestamp = Math.max(...releases.map((release) => Date.parse(release.publishedAt)));
  if (!Number.isFinite(latestTimestamp)) return '—';
  const days = Math.max(0, Math.floor((Date.now() - latestTimestamp) / 86_400_000));
  if (days === 0) return '今日';
  if (days < 30) return `${days}日前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}か月前`;
  return `${Math.floor(months / 12)}年前`;
}

function dashboardStats(context: RecommendationContext) {
  return {
    releasesAnalyzed: context.pastReleases.length,
    genresFound: new Set(context.pastReleases.map((release) => release.genre)).size,
    lastPublished: relativePublishedAt(context.pastReleases),
  };
}

function genericSuggestions(context: RecommendationContext): ExistingSuggestion[] {
  const releases = [...context.pastReleases].sort((left, right) => right.pageView - left.pageView);
  if (releases.length === 0) return [];
  const angles = [
    { genre: '開発秘話', eyebrow: '過去記事 × 開発の背景', lead: '発表の裏側をひもとく' },
    { genre: '担当者インタビュー', eyebrow: '過去記事 × 働く人', lead: '担当者の言葉で振り返る' },
    { genre: 'データ解説', eyebrow: '過去記事 × 読者の反応', lead: '反響から次の可能性を読む' },
    { genre: 'これからの展望', eyebrow: '過去記事 × 次の一歩', lead: '発表後の変化と未来を伝える' },
  ];

  return angles.map((angle, index) => {
    const release = releases[index % releases.length]!;
    return {
      id: `release-${release.id}-${index + 1}`,
      genre: angle.genre,
      eyebrow: angle.eyebrow,
      title: `${angle.lead}。「${release.title}」の先にある物語`,
      summary: `${release.summary}という過去の発信を起点に、発表までの判断や公開後の変化を関係者への取材で具体化します。`,
      whyNow:
        release.pageView > 0
          ? `過去記事は${new Intl.NumberFormat('ja-JP').format(release.pageView)}PVを記録しており、関心を次の物語へつなげられます。`
          : '過去の発表を現在の視点で振り返り、継続的な取り組みとして伝えられます。',
      contentOutline: [
        `背景｜「${release.title}」の企画は、顧客や現場から届いたどんな課題感から始まったのかを紹介します。`,
        '判断｜初期案では解決できなかったことと、担当者が方針を変えた瞬間を具体的なエピソードで描きます。',
        '現在地｜公開後に寄せられた反応や現場の変化を振り返り、次に実現したいことへつなげます。',
      ],
      sourceTitle: release.title,
      sourceReleaseId: release.id,
      similarity: 0,
    };
  });
}

function genericNewOpportunity(context: RecommendationContext): NewOpportunity {
  const genres = Array.from(new Set(context.pastReleases.map((release) => release.genre))).join('・');
  return {
    id: 'people-behind-company',
    genre: '人・カルチャー',
    eyebrow: 'まだ発信していない魅力',
    title: `${context.company.name}を動かす人と、日々の小さな工夫`,
    summary: '商品やサービスの発表では見えにくい、働く人の判断やチームの日常を主役にする企画です。',
    opportunityReason: `過去配信は${genres || '商品・サービス'}が中心です。企業情報にある「${context.company.description}」を実現する人や組織の姿は、新しい発信の入口になります。`,
    pitch: `${context.company.name}の取り組みは、どんな人の、どんな判断から生まれているのでしょうか。日々の仕事で大切にしていることや、小さな改善の積み重ねを担当者への取材でひもときます。商品説明だけでは伝わらない、会社らしさが見える企画です。`,
    contentOutline: [
      'きっかけ｜「入社当初は○○に戸惑った」という担当者の言葉から、現在の役割を選んだ理由をひもときます。',
      '日常｜朝会や顧客対応など、チームが日々繰り返している判断と小さな工夫を具体的に紹介します。',
      '変化｜「お客様の一言が、チームの動きを変えた」という出来事を、関係者への取材で確かめます。',
      'これから｜今後届けたい価値と、そのために次に挑戦することを担当者の言葉で結びます。',
    ],
    interviewQuestions: [
      '日々の仕事で最も大切にしている判断は何ですか？',
      'チームらしさを感じた出来事を教えてください。',
      'これから誰にどんな価値を届けたいですか？',
    ],
  };
}

function buildFallbackDashboard(loaded: LoadedContext): RecommendationDashboard {
  const useCuratedSeedContent = loaded.context.company.id === '900001';
  const cadence = classifyPostingCadence(loaded.context.pastReleases);
  return {
    company: loaded.context.company,
    stats: dashboardStats(loaded.context),
    existingSuggestions: useCuratedSeedContent
      ? structuredClone(demoSuggestions)
      : genericSuggestions(loaded.context),
    newOpportunity: useCuratedSeedContent
      ? structuredClone(demoNewOpportunity)
      : genericNewOpportunity(loaded.context),
    meta: {
      generatedAt: new Date().toISOString(),
      mode: 'demo',
      dataSource: loaded.dataSource,
      similarityMethod: 'OpenAI API未設定のため未実行',
      ...cadence,
    },
  };
}

export async function getDemoDashboard(companyId = '900001'): Promise<RecommendationDashboard> {
  return buildFallbackDashboard(await loadContext(companyId));
}

const generatedPayloadSchema = z.object({
  existingSuggestions: z
    .array(
      z.object({
        id: z.string(),
        genre: z.string(),
        eyebrow: z.string(),
        title: z.string(),
        summary: z.string(),
        whyNow: z.string(),
        contentOutline: z.array(z.string().min(20)).min(3).max(3),
        sourceReleaseId: z.string(),
      }),
    )
    .min(4)
    .max(4),
  newOpportunity: z.object({
    id: z.string(),
    genre: z.string(),
    eyebrow: z.string(),
    title: z.string(),
    summary: z.string(),
    opportunityReason: z.string(),
    pitch: z.string(),
    contentOutline: z.array(z.string().min(20)).min(4).max(4),
    interviewQuestions: z.array(z.string()).min(3).max(3),
  }),
});

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['existingSuggestions', 'newOpportunity'],
  properties: {
    existingSuggestions: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'genre', 'eyebrow', 'title', 'summary', 'whyNow', 'contentOutline', 'sourceReleaseId'],
        properties: {
          id: { type: 'string' },
          genre: { type: 'string' },
          eyebrow: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          whyNow: { type: 'string' },
          contentOutline: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: { type: 'string', minLength: 20 },
          },
          sourceReleaseId: { type: 'string' },
        },
      },
    },
    newOpportunity: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'genre',
        'eyebrow',
        'title',
        'summary',
        'opportunityReason',
        'pitch',
        'contentOutline',
        'interviewQuestions',
      ],
      properties: {
        id: { type: 'string' },
        genre: { type: 'string' },
        eyebrow: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        opportunityReason: { type: 'string' },
        pitch: { type: 'string' },
        contentOutline: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: { type: 'string', minLength: 20 },
        },
        interviewQuestions: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'string' },
        },
      },
    },
  },
} as const;

async function openAiRequest(path: string, body: object): Promise<unknown> {
  if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.OPENAI_TIMEOUT_MS),
    });

    if (response.ok) return response.json();

    const detail = (await response.text()).slice(0, 500);
    const requestId = response.headers.get('x-request-id');
    const canRetry = response.status === 429 || response.status >= 500;
    if (attempt === 0 && canRetry) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      continue;
    }
    throw new Error(
      `OpenAI API ${response.status}${requestId ? ` (${requestId})` : ''}: ${detail}`,
    );
  }
  throw new Error('OpenAI API request failed');
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid OpenAI response');
  const response = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  if (typeof response.output_text === 'string') return response.output_text;

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OpenAI response did not contain output text');
}

type RankedSimilarRelease = Pick<
  SimilarRelease,
  'companyName' | 'title' | 'genre' | 'summary' | 'pageView' | 'likeCount'
> & { similarity: number };

async function generateCopy(
  context: RecommendationContext,
  similarExamples: RankedSimilarRelease[],
  cadence: PostingCadence,
) {
  const promptCompany = {
    name: context.company.name,
    industry: context.company.industry,
    description: context.company.description,
  };
  const promptReleases = context.pastReleases.slice(0, 20).map((release) => ({
    id: release.id,
    genre: release.genre,
    title: release.title,
    summary: release.summary,
    publishedAt: release.publishedAt,
    pageView: release.pageView,
    likeCount: release.likeCount,
    keywords: release.keywords,
  }));
  const payload = await openAiRequest('responses', {
    model: config.OPENAI_TEXT_MODEL,
    store: false,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              'あなたは中小企業専門の広報編集者です。自社の過去配信を活かした企画4件と、過去に発信していない魅力を掘り起こす企画1件を日本語で提案してください。recommendedFocusがexistingの場合は、久しぶりの配信を無理なく再開できるよう、左側の過去記事活用案を最優先で作ってください。recommendedFocusがnewの場合は、最近も配信している企業の発信が単調にならないよう、右側の未発信ジャンルを明確に差別化してください。各contentOutlineは見出しだけで終わらせず、「見出し｜本文に使える具体例の文章」の形式にし、一般論ではなく入力データの固有情報を反映してください。ただし、自社データに存在しない実績・制度・人数・顧客の声は事実として作らず、未確認事項は「取材で確かめる」「例えば」などの企画仮説として表現してください。既存企画はそれぞれ実在するsourceReleaseIdを1つ指定し、できるだけ異なる過去配信を起点にしてください。他社類似事例は切り口の参考に限り、社名・商品名・実績を自社の事実として転用しないでください。タイトルは具体的で、人や判断が見える表現を優先してください。',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              company: promptCompany,
              postingCadence: cadence,
              pastReleases: promptReleases,
              similarExamples,
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'pr_recommendations',
        strict: true,
        schema: responseJsonSchema,
      },
    },
  });

  return generatedPayloadSchema.parse(JSON.parse(extractResponseText(payload)));
}

async function createEmbeddings(input: string[]): Promise<number[][]> {
  if (input.length === 0) return [];
  const payload = await openAiRequest('embeddings', {
    model: config.OPENAI_EMBEDDING_MODEL,
    input,
    encoding_format: 'float',
  });

  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error('Invalid embeddings response');
  }

  const rows = (payload as { data: Array<{ index: number; embedding: number[] }> }).data;
  return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

const embeddingCache = new Map<string, number[]>();

async function createCachedEmbeddings(input: string[]): Promise<number[][]> {
  const keys = input.map((text) => `${config.OPENAI_EMBEDDING_MODEL}\u0000${text}`);
  const missingIndexes = keys
    .map((key, index) => (embeddingCache.has(key) ? -1 : index))
    .filter((index) => index >= 0);

  if (missingIndexes.length > 0) {
    const missingVectors = await createEmbeddings(missingIndexes.map((index) => input[index]!));
    missingIndexes.forEach((originalIndex, vectorIndex) => {
      const key = keys[originalIndex];
      const vector = missingVectors[vectorIndex];
      if (key && vector) embeddingCache.set(key, vector);
    });
  }

  return keys.map((key) => embeddingCache.get(key) ?? []);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? 0 : dot / denominator;
}

async function scoreSuggestions(
  suggestions: z.infer<typeof generatedPayloadSchema>['existingSuggestions'],
  releases: PastRelease[],
): Promise<number[]> {
  const suggestionTexts = suggestions.map(
    (suggestion) => `${suggestion.genre}\n${suggestion.title}\n${suggestion.summary}`,
  );
  const releaseTexts = releases.map((release) => `${release.genre}\n${release.title}\n${release.summary}`);
  const vectors = await createCachedEmbeddings([...suggestionTexts, ...releaseTexts]);
  const suggestionVectors = vectors.slice(0, suggestions.length);
  const releaseVectors = vectors.slice(suggestions.length);

  return suggestionVectors.map((suggestionVector) => {
    const closest = Math.max(...releaseVectors.map((releaseVector) => cosineSimilarity(suggestionVector, releaseVector)));
    return Math.max(0, Math.min(100, Math.round(closest * 100)));
  });
}

function releaseEmbeddingText(release: PastRelease): string {
  return [release.genre, release.title, release.summary, release.keywords.join(' ')].join('\n');
}

async function rankSimilarExamples(context: RecommendationContext): Promise<RankedSimilarRelease[]> {
  const ownReleases = context.pastReleases.slice(0, 20);
  const candidates = context.candidateReleases.slice(0, 80);
  if (ownReleases.length === 0 || candidates.length === 0) return [];

  const vectors = await createCachedEmbeddings([
    ...ownReleases.map(releaseEmbeddingText),
    ...candidates.map(releaseEmbeddingText),
  ]);
  const ownVectors = vectors.slice(0, ownReleases.length);
  const candidateVectors = vectors.slice(ownReleases.length);

  return candidates
    .map((release, index) => ({
      companyName: release.companyName,
      title: release.title,
      genre: release.genre,
      summary: release.summary,
      pageView: release.pageView,
      likeCount: release.likeCount,
      similarity: Math.round(
        Math.max(...ownVectors.map((ownVector) => cosineSimilarity(ownVector, candidateVectors[index] ?? []))) * 100,
      ),
    }))
    .sort((left, right) => right.similarity - left.similarity || right.pageView - left.pageView)
    .slice(0, 8);
}

type DashboardCacheEntry = { value: RecommendationDashboard; expiresAt: number };
const dashboardCache = new Map<string, DashboardCacheEntry>();
const inFlightGeneration = new Map<string, Promise<RecommendationDashboard>>();

function cachedDashboard(companyId: string): RecommendationDashboard | undefined {
  const entry = dashboardCache.get(companyId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    dashboardCache.delete(companyId);
    return undefined;
  }
  return entry.value;
}

function cacheDashboard(companyId: string, dashboard: RecommendationDashboard): void {
  dashboardCache.set(companyId, {
    value: dashboard,
    expiresAt: Date.now() + config.RECOMMENDATION_CACHE_TTL_MS,
  });
}

export async function listRecommendationCompanies(): Promise<CompanySummary[]> {
  if (config.NODE_ENV === 'test' || config.RECOMMENDATION_DATA_SOURCE === 'mock') {
    return mockContextProvider.listCompanies();
  }
  if (
    config.RECOMMENDATION_DATA_SOURCE === 'production_subset' ||
    config.RECOMMENDATION_DATA_SOURCE === 'auto'
  ) {
    try {
      const companies = await productionSubsetContextProvider.listCompanies();
      if (companies.length > 0) return companies;
    } catch (error) {
      if (config.RECOMMENDATION_DATA_SOURCE === 'production_subset') throw error;
    }
  }
  try {
    const companies = await postgresContextProvider.listCompanies();
    return companies.length > 0 ? companies : mockContextProvider.listCompanies();
  } catch (error) {
    if (config.RECOMMENDATION_DATA_SOURCE === 'database') throw error;
    return mockContextProvider.listCompanies();
  }
}

async function resolveCompanyId(companyId?: string): Promise<string> {
  if (companyId) return companyId;
  if (config.NODE_ENV === 'test' || config.RECOMMENDATION_DATA_SOURCE === 'mock') return '900001';

  if (
    config.RECOMMENDATION_DATA_SOURCE === 'production_subset' ||
    config.RECOMMENDATION_DATA_SOURCE === 'auto'
  ) {
    try {
      const companies = await productionSubsetContextProvider.listCompanies();
      const firstCompany = companies[0];
      if (firstCompany) return firstCompany.id;
    } catch (error) {
      if (config.RECOMMENDATION_DATA_SOURCE === 'production_subset') throw error;
    }
  }

  try {
    const companies = await postgresContextProvider.listCompanies();
    const firstCompany = companies[0];
    if (firstCompany) return firstCompany.id;
  } catch (error) {
    if (config.RECOMMENDATION_DATA_SOURCE === 'database') throw error;
  }
  return '900001';
}

export async function getRecommendationDashboard(companyId?: string) {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  const cached = cachedDashboard(resolvedCompanyId);
  if (cached) return cached;
  if (!config.OPENAI_API_KEY) {
    const fallback = await getDemoDashboard(resolvedCompanyId);
    cacheDashboard(resolvedCompanyId, fallback);
    return fallback;
  }
  return regenerateRecommendationDashboard(resolvedCompanyId);
}

export async function regenerateRecommendationDashboard(
  companyId?: string,
): Promise<RecommendationDashboard> {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  const activeGeneration = inFlightGeneration.get(resolvedCompanyId);
  if (activeGeneration) return activeGeneration;

  const generation = generateDashboard(resolvedCompanyId).finally(() => {
    inFlightGeneration.delete(resolvedCompanyId);
  });
  inFlightGeneration.set(resolvedCompanyId, generation);
  return generation;
}

async function generateDashboard(companyId: string): Promise<RecommendationDashboard> {
  const loaded = await loadContext(companyId);
  if (!config.OPENAI_API_KEY || loaded.context.pastReleases.length === 0) {
    const fallback = buildFallbackDashboard(loaded);
    cacheDashboard(companyId, fallback);
    return fallback;
  }

  try {
    const cadence = classifyPostingCadence(loaded.context.pastReleases);
    const similarExamples = await rankSimilarExamples(loaded.context);
    const generated = await generateCopy(loaded.context, similarExamples, cadence);
    const similarities = await scoreSuggestions(generated.existingSuggestions, loaded.context.pastReleases);
    const releaseById = new Map(loaded.context.pastReleases.map((release) => [release.id, release]));
    const defaultSource = loaded.context.pastReleases[0]!;
    const existingSuggestions = generated.existingSuggestions
      .map((suggestion, index): ExistingSuggestion => {
        const source = releaseById.get(suggestion.sourceReleaseId) ?? defaultSource;
        return {
          ...suggestion,
          sourceReleaseId: source.id,
          sourceTitle: source.title,
          similarity: similarities[index] ?? 0,
        };
      })
      .sort((left, right) => right.similarity - left.similarity);
    const dashboard: RecommendationDashboard = {
      company: loaded.context.company,
      stats: dashboardStats(loaded.context),
      existingSuggestions,
      newOpportunity: generated.newOpportunity,
      meta: {
        generatedAt: new Date().toISOString(),
        mode: 'openai',
        dataSource: loaded.dataSource,
        similarityMethod: `${config.OPENAI_EMBEDDING_MODEL} のコサイン類似度`,
        ...cadence,
      },
    };
    cacheDashboard(companyId, dashboard);
    return dashboard;
  } catch (error) {
    console.error('Recommendation generation failed; serving demo data instead.', error);
    const fallback = buildFallbackDashboard(loaded);
    cacheDashboard(companyId, fallback);
    return fallback;
  }
}
