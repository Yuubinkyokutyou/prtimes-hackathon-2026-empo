import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import {
  findCachedRecommendation,
  insertRecommendationGeneration,
} from './recommendationCacheRepository.js';
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
  RecommendationDashboard,
  RecommendationGenerationOptions,
  SimilarRelease,
} from './recommendationTypes.js';

export type {
  CompanyProfile,
  CompanySummary,
  ExistingSuggestion,
  NewOpportunity,
  RecommendationDashboard,
  RecommendationGenerationOptions,
  RecommendationHistoryItem,
} from './recommendationTypes.js';

const postgresContextProvider = new PostgresRecommendationContextProvider();
const productionSubsetContextProvider = new ProductionSubsetRecommendationContextProvider();

const generationOptionsSchema = z.object({
  focus: z.enum(['auto', 'existing', 'new']).optional(),
  tone: z.enum(['standard', 'formal', 'friendly', 'bold']).optional(),
  audience: z.string().trim().max(200).optional(),
  objective: z.string().trim().max(300).optional(),
  additionalContext: z.string().trim().max(2_000).optional(),
});

export function normalizeGenerationOptions(input?: unknown): RecommendationGenerationOptions {
  const parsed = generationOptionsSchema.parse(input ?? {});
  return {
    focus: parsed.focus ?? 'auto',
    tone: parsed.tone ?? 'standard',
    audience: parsed.audience ?? '',
    objective: parsed.objective ?? '',
    additionalContext: parsed.additionalContext ?? '',
  };
}

type LoadedContext = {
  context: RecommendationContext;
  dataSource: 'production_subset' | 'database';
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

async function loadContext(companyId: string): Promise<LoadedContext> {
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

  return { context: await postgresContextProvider.get(companyId), dataSource: 'database' };
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
      sourceUrl: release.sourceUrl,
      sourceEvidence: release.summary,
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

function cadenceFor(
  context: RecommendationContext,
  options: RecommendationGenerationOptions,
): PostingCadence {
  const cadence = classifyPostingCadence(context.pastReleases);
  return options.focus === 'auto'
    ? cadence
    : { ...cadence, recommendedFocus: options.focus };
}

function buildTemplateDashboard(
  loaded: LoadedContext,
  options: RecommendationGenerationOptions,
): RecommendationDashboard {
  const cadence = cadenceFor(loaded.context, options);
  return {
    company: loaded.context.company,
    stats: dashboardStats(loaded.context),
    existingSuggestions: genericSuggestions(loaded.context),
    newOpportunity: genericNewOpportunity(loaded.context),
    meta: {
      generatedAt: new Date().toISOString(),
      mode: 'template',
      dataSource: loaded.dataSource,
      similarityMethod: 'OpenAI API未設定のため未実行',
      ...cadence,
      generationId: randomUUID(),
      conditions: options,
      saved: false,
    },
  };
}

export async function getTemplateDashboard(
  companyId: string,
  input?: unknown,
): Promise<RecommendationDashboard> {
  const options = normalizeGenerationOptions(input);
  return buildTemplateDashboard(await loadContext(companyId), options);
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
  options: RecommendationGenerationOptions,
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
              'あなたは中小企業専門の広報編集者です。自社の過去配信を活かした企画4件と、過去に発信していない魅力を掘り起こす企画1件を日本語で提案してください。recommendedFocusがexistingの場合は、久しぶりの配信を無理なく再開できるよう、左側の過去記事活用案を最優先で作ってください。recommendedFocusがnewの場合は、最近も配信している企業の発信が単調にならないよう、右側の未発信ジャンルを明確に差別化してください。generationConditionsの読者・目的・文体・追加情報を反映してください。各contentOutlineは見出しだけで終わらせず、「見出し｜本文に使える具体例の文章」の形式にし、一般論ではなく入力データの固有情報を反映してください。ただし、自社データに存在しない実績・制度・人数・顧客の声は事実として作らず、未確認事項は「取材で確かめる」「例えば」などの企画仮説として表現してください。既存企画はそれぞれ実在するsourceReleaseIdを1つ指定し、できるだけ異なる過去配信を起点にしてください。他社類似事例は切り口の参考に限り、社名・商品名・実績を自社の事実として転用しないでください。タイトルは具体的で、人や判断が見える表現を優先してください。',
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
              generationConditions: options,
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
let storageWarningLogged = false;

function cacheKeyFor(companyId: string, options: RecommendationGenerationOptions): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      version: 3,
      companyId,
      options,
      dataSource: config.RECOMMENDATION_DATA_SOURCE,
      textModel: config.OPENAI_TEXT_MODEL,
      embeddingModel: config.OPENAI_EMBEDDING_MODEL,
    }))
    .digest('hex');
  return `${companyId}:${digest}`;
}

function cachedDashboard(cacheKey: string): RecommendationDashboard | undefined {
  const entry = dashboardCache.get(cacheKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    dashboardCache.delete(cacheKey);
    return undefined;
  }
  return entry.value;
}

function cacheDashboard(cacheKey: string, dashboard: RecommendationDashboard): void {
  dashboardCache.set(cacheKey, {
    value: dashboard,
    expiresAt: Date.now() + config.RECOMMENDATION_CACHE_TTL_MS,
  });
}

async function persistentCachedDashboard(
  cacheKey: string,
): Promise<RecommendationDashboard | undefined> {
  if (!config.RECOMMENDATION_STORAGE_ENABLED) return undefined;
  try {
    return await findCachedRecommendation(cacheKey);
  } catch (error) {
    if (!storageWarningLogged) {
      console.warn('Persistent recommendation cache is unavailable; using memory cache.', error);
      storageWarningLogged = true;
    }
    return undefined;
  }
}

async function persistDashboard(
  cacheKey: string,
  companyId: string,
  dashboard: RecommendationDashboard,
  options: RecommendationGenerationOptions,
): Promise<RecommendationDashboard> {
  cacheDashboard(cacheKey, dashboard);
  if (!config.RECOMMENDATION_STORAGE_ENABLED) return dashboard;
  try {
    await insertRecommendationGeneration(
      cacheKey,
      companyId,
      dashboard,
      options,
      config.RECOMMENDATION_CACHE_TTL_MS,
    );
  } catch (error) {
    if (!storageWarningLogged) {
      console.warn('Could not persist recommendation generation; continuing in memory.', error);
      storageWarningLogged = true;
    }
  }
  return dashboard;
}

export function refreshEditedDashboardCache(dashboard: RecommendationDashboard): void {
  for (const [key, entry] of dashboardCache) {
    if (entry.value.meta.generationId === dashboard.meta.generationId) {
      dashboardCache.set(key, { ...entry, value: dashboard });
    }
  }
}

export async function listRecommendationCompanies(): Promise<CompanySummary[]> {
  if (
    config.RECOMMENDATION_DATA_SOURCE === 'production_subset' ||
    config.RECOMMENDATION_DATA_SOURCE === 'auto'
  ) {
    try {
      const companies = await productionSubsetContextProvider.listCompanies();
      if (companies.length > 0 || config.RECOMMENDATION_DATA_SOURCE === 'production_subset') {
        return companies;
      }
    } catch (error) {
      if (config.RECOMMENDATION_DATA_SOURCE === 'production_subset') throw error;
    }
  }
  return postgresContextProvider.listCompanies();
}

async function resolveCompanyId(companyId?: string): Promise<string> {
  if (companyId) return companyId;

  if (
    config.RECOMMENDATION_DATA_SOURCE === 'production_subset' ||
    config.RECOMMENDATION_DATA_SOURCE === 'auto'
  ) {
    try {
      const companies = await productionSubsetContextProvider.listCompanies();
      const firstCompany = companies[0];
      if (firstCompany) return firstCompany.id;
      if (config.RECOMMENDATION_DATA_SOURCE === 'production_subset') {
        throw new Error('production_subset contains no companies with published releases');
      }
    } catch (error) {
      if (config.RECOMMENDATION_DATA_SOURCE === 'production_subset') throw error;
    }
  }

  const companies = await postgresContextProvider.listCompanies();
  const firstCompany = companies[0];
  if (firstCompany) return firstCompany.id;
  throw new Error('Database contains no companies with published releases');
}

export async function getRecommendationDashboard(companyId?: string, input?: unknown) {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  const options = normalizeGenerationOptions(input);
  const cacheKey = cacheKeyFor(resolvedCompanyId, options);
  const cached = cachedDashboard(cacheKey);
  if (cached) return cached;
  const persisted = await persistentCachedDashboard(cacheKey);
  if (persisted) {
    cacheDashboard(cacheKey, persisted);
    return persisted;
  }
  return regenerateRecommendationDashboard(resolvedCompanyId, options);
}

export async function regenerateRecommendationDashboard(
  companyId?: string,
  input?: unknown,
): Promise<RecommendationDashboard> {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  const options = normalizeGenerationOptions(input);
  const cacheKey = cacheKeyFor(resolvedCompanyId, options);
  const activeGeneration = inFlightGeneration.get(cacheKey);
  if (activeGeneration) return activeGeneration;

  const generation = generateDashboard(resolvedCompanyId, options, cacheKey).finally(() => {
    inFlightGeneration.delete(cacheKey);
  });
  inFlightGeneration.set(cacheKey, generation);
  return generation;
}

async function generateDashboard(
  companyId: string,
  options: RecommendationGenerationOptions,
  cacheKey: string,
): Promise<RecommendationDashboard> {
  const loaded = await loadContext(companyId);
  if (!config.OPENAI_API_KEY || loaded.context.pastReleases.length === 0) {
    const dashboard = buildTemplateDashboard(loaded, options);
    return persistDashboard(cacheKey, companyId, dashboard, options);
  }

  try {
    const cadence = cadenceFor(loaded.context, options);
    const similarExamples = await rankSimilarExamples(loaded.context);
    const generated = await generateCopy(loaded.context, similarExamples, cadence, options);
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
          sourceUrl: source.sourceUrl,
          sourceEvidence: source.summary,
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
        generationId: randomUUID(),
        conditions: options,
        saved: false,
      },
    };
    return persistDashboard(cacheKey, companyId, dashboard, options);
  } catch (error) {
    console.error('Recommendation generation failed; serving template-generated recommendations.', error);
    const dashboard = buildTemplateDashboard(loaded, options);
    return persistDashboard(cacheKey, companyId, dashboard, options);
  }
}
