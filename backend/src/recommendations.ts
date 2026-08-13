import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { extractResponseText, openAiRequest } from './openAiClient.js';
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
  ReferenceExample,
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

const itemRegenerationSchema = z.object({
  layer: z.enum(['existing', 'new']),
  sourceReleaseId: z.string().trim().max(100).optional(),
  currentTitle: z.string().trim().max(500).default(''),
  excludedTitles: z.array(z.string().trim().max(500)).max(20).default([]),
  conditions: z.unknown().optional(),
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
  const latestPublishedAt = context.pastReleases
    .map((release) => release.publishedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? new Date().toISOString();
  return {
    releasesAnalyzed: context.pastReleases.length,
    genresFound: new Set(context.pastReleases.map((release) => release.genre)).size,
    lastPublished: relativePublishedAt(context.pastReleases),
    dataUpdatedAt: latestPublishedAt,
  };
}

function sourceReleases(context: RecommendationContext) {
  return context.pastReleases.map(({ id, title, publishedAt, sourceUrl, imageUrl, pageView }) => ({
    id,
    title,
    publishedAt,
    sourceUrl,
    imageUrl,
    pageView,
  }));
}

function compactReleaseTitle(value: string, maxLength = 38): string {
  const characters = Array.from(value.replace(/\s+/gu, ' ').trim());
  return characters.length <= maxLength
    ? characters.join('')
    : `${characters.slice(0, maxLength - 1).join('')}…`;
}

function releaseSubject(value: string): string {
  const compact = compactReleaseTitle(value)
    .replace(/[「」]/gu, '')
    .replace(/(?:を)?(?:提供|販売|公開)?開始(?:しました)?$/u, '')
    .replace(/(?:を)?発売(?:しました)?$/u, '')
    .trim();
  return compact || compactReleaseTitle(value);
}

function toReferenceExample(release: ReferenceExample): ReferenceExample {
  return {
    companyName: release.companyName,
    title: release.title,
    summary: release.summary,
    sourceUrl: release.sourceUrl,
    imageUrl: release.imageUrl,
  };
}

function templateReferenceExample(
  source: PastRelease,
  candidates: SimilarRelease[],
): ReferenceExample | undefined {
  const sourceKeywords = new Set(source.keywords);
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score:
        (candidate.genre === source.genre ? 10 : 0)
        + candidate.keywords.filter((keyword) => sourceKeywords.has(keyword)).length * 3,
    }))
    .sort((left, right) =>
      right.score - left.score
      || right.candidate.pageView - left.candidate.pageView
      || right.candidate.likeCount - left.candidate.likeCount,
    );
  return ranked[0] ? toReferenceExample(ranked[0].candidate) : undefined;
}

function genericSuggestions(context: RecommendationContext): ExistingSuggestion[] {
  const releases = [...context.pastReleases].sort((left, right) => right.pageView - left.pageView);
  if (releases.length === 0) return [];
  const angles = [
    {
      genre: '開発の経緯',
      eyebrow: '過去記事 × 開発の背景',
      title: (subject: string) => `${subject}はどうやって生まれたか。企画担当者に聞く`,
      summary: '企画が始まった理由、途中で変えたこと、発表までに迷った点を担当者に聞きます。',
    },
    {
      genre: '担当者インタビュー',
      eyebrow: '過去記事 × 担当者',
      title: (subject: string) => `${subject}の開発で、担当者がいちばん迷ったこと`,
      summary: '担当者の役割、実際に手を動かした作業、判断が必要だった場面を取材します。',
    },
    {
      genre: 'その後の反応',
      eyebrow: '過去記事 × 公開後',
      title: (subject: string) => `${subject}の発表後、現場で変わったこと`,
      summary: '公開後に届いた反応と、その後に変更した点があるかを確認します。',
    },
    {
      genre: '続報',
      eyebrow: '過去記事 × これから',
      title: (subject: string) => `${subject}の次の予定を担当者に聞く`,
      summary: '現在の課題と、次に予定している改善や展開を担当者に聞きます。',
    },
  ];

  return angles.map((angle, index) => {
    const release = releases[index % releases.length]!;
    const sourceTitle = compactReleaseTitle(release.title);
    const subject = releaseSubject(release.title);
    return {
      id: `release-${release.id}-${index + 1}`,
      genre: angle.genre,
      eyebrow: angle.eyebrow,
      title: angle.title(subject),
      summary: angle.summary,
      whyNow:
        release.pageView > 0
          ? `元の記事は${new Intl.NumberFormat('ja-JP').format(release.pageView)}PV読まれています。続報として出しやすいテーマです。`
          : '前回の発表から時間がたっているため、「その後」を伝えるだけでも読み手に新しい情報を出せます。',
      contentOutline: [
        `発表時の状況｜「${sourceTitle}」を出すことになった背景と、当時の課題を担当者に確認します。`,
        '担当者の判断｜途中で迷った点、方針を決めた理由、実際に工夫したことを聞きます。',
        '発表後｜公開後の反応、現場で変わったこと、次に予定していることを整理します。',
      ],
      sourceTitle: release.title,
      sourceReleaseId: release.id,
      sourceUrl: release.sourceUrl,
      sourceImageUrl: release.imageUrl,
      referenceExample: templateReferenceExample(release, context.candidateReleases),
      similarity: 0,
    };
  });
}

function genericNewOpportunities(context: RecommendationContext): NewOpportunity[] {
  const genres = Array.from(new Set(context.pastReleases.map((release) => release.genre))).join('・');
  const reason = `過去配信は${genres || '商品・サービス'}が中心です。商品紹介と重なりにくく、会社の普段の姿を伝えられる切り口です。`;
  return [
    {
      id: 'people-behind-company',
      genre: '人・カルチャー',
      eyebrow: 'これまで扱っていないテーマ',
      title: `${context.company.name}の担当者に聞く、普段の仕事と判断`,
      summary: '担当者の一日や、仕事で迷ったときの判断基準を取材します。商品紹介とは違う角度で会社を知ってもらう案です。',
      opportunityReason: reason,
      pitch: `${context.company.name}の担当者に、普段どんな仕事をしているのか、判断に迷ったとき何を基準にしているのかを聞きます。実際の一日や最近あった出来事を入れると、仕事内容が具体的に伝わります。`,
      contentOutline: [
        '担当業務｜所属、担当している仕事、一日の流れを具体的に聞きます。',
        '判断基準｜仕事で迷った場面と、そのとき何を優先して決めたのかを聞きます。',
        '最近の出来事｜顧客や同僚とのやり取りで印象に残っている出来事を確認します。',
        '今後｜これから改善したいこと、次に取り組む予定を本人の言葉でまとめます。',
      ],
    },
    {
      id: 'how-work-moves',
      genre: '仕事の進め方',
      eyebrow: '社内の動きを伝えるテーマ',
      title: `${context.company.name}で企画が決まるまで。担当者同士の相談と判断`,
      summary: 'ひとつの企画が決まるまでに、誰がどのように相談し、何を基準に判断しているかを取材します。',
      opportunityReason: reason,
      pitch: '完成した商品やサービスではなく、その前にある相談や判断を取り上げます。実際の進め方を具体的に聞くことで、働く人や組織の特徴が伝わる企画にします。',
      contentOutline: [
        '企画の入口｜普段どこから相談や提案が始まるのかを確認します。',
        '相談の流れ｜関わる担当者と、意見をまとめるまでの進め方を聞きます。',
        '判断する場面｜迷ったときに重視する条件と、最近の具体例を取材します。',
        '改善点｜今の進め方で変えたいこと、次に試したいことをまとめます。',
      ],
    },
    {
      id: 'small-improvements',
      genre: '日々の改善',
      eyebrow: '日常の工夫を伝えるテーマ',
      title: `${context.company.name}の現場で続けている、小さな改善を担当者に聞く`,
      summary: '日々の仕事で変えたことや、続けている小さな工夫を担当者の具体例から紹介します。',
      opportunityReason: reason,
      pitch: '大きな発表では取り上げにくい日々の改善を集めます。何に困り、どう変え、仕事がどう進めやすくなったのかを事実確認しながら整理します。',
      contentOutline: [
        '以前の課題｜日常業務で困っていたことを具体的に確認します。',
        '変えたこと｜担当者が試した方法と、実施するまでの経緯を聞きます。',
        '現在の様子｜変えた後の仕事の進め方と、周囲の反応を確認します。',
        '次の改善｜まだ残っている課題と、今後試したいことをまとめます。',
      ],
    },
    {
      id: 'office-and-tools',
      genre: '仕事道具・環境',
      eyebrow: '働く環境を伝えるテーマ',
      title: `${context.company.name}の担当者が毎日使う道具と、選んでいる理由`,
      summary: '普段使っている道具や作業環境を取り上げ、仕事に合わせて選んだ理由を担当者に聞きます。',
      opportunityReason: reason,
      pitch: '担当者が日常的に使う道具や環境から、仕事の具体像を伝えます。一般的な紹介にせず、選んだ理由や使い方を本人に確認します。',
      contentOutline: [
        '普段の仕事｜担当業務と、作業する場所や時間帯を確認します。',
        '使っている道具｜毎日使うものと、具体的な使い方を聞きます。',
        '選んだ理由｜以前との違いや、選ぶときに重視した点を確認します。',
        'これから｜今後変えたい環境や試したい道具をまとめます。',
      ],
    },
    {
      id: 'learning-from-work',
      genre: '学び・振り返り',
      eyebrow: '経験を共有するテーマ',
      title: `${context.company.name}の担当者が最近の仕事から学んだこと`,
      summary: '最近の仕事で予想と違ったことや、次から変えようとしていることを担当者に聞きます。',
      opportunityReason: reason,
      pitch: '成功談だけでなく、実際の仕事から得た学びを取り上げます。公開できる範囲を確認しながら、判断や改善の具体例を企画にします。',
      contentOutline: [
        '最近の仕事｜今回振り返る業務と、担当者の役割を確認します。',
        '予想との違い｜当初の想定と実際に起きたことを具体的に聞きます。',
        '学んだこと｜判断を変えた点と、次回に活かす内容を整理します。',
        '次の予定｜今後試すことと、確認していきたい変化をまとめます。',
      ],
    },
  ];
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
  generationNotice?: string,
): RecommendationDashboard {
  const cadence = cadenceFor(loaded.context, options);
  return {
    company: loaded.context.company,
    stats: dashboardStats(loaded.context),
    sourceReleases: sourceReleases(loaded.context),
    existingSuggestions: genericSuggestions(loaded.context),
    newOpportunities: genericNewOpportunities(loaded.context).slice(0, 3),
    meta: {
      generatedAt: new Date().toISOString(),
      mode: 'template',
      dataSource: loaded.dataSource,
      similarityMethod: 'OpenAI API未設定のため未実行',
      ...cadence,
      generationId: randomUUID(),
      conditions: options,
      saved: false,
      ...(generationNotice ? { generationNotice } : {}),
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
  newOpportunities: z.array(z.object({
    id: z.string(),
    genre: z.string(),
    eyebrow: z.string(),
    title: z.string(),
    summary: z.string(),
    opportunityReason: z.string(),
    pitch: z.string(),
    contentOutline: z.array(z.string().min(20)).min(4).max(4),
  })).min(3).max(3),
});

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['existingSuggestions', 'newOpportunities'],
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
    newOpportunities: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
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
        },
      },
    },
  },
} as const;

const regeneratedExistingSchema = z.object({
  genre: z.string(),
  eyebrow: z.string(),
  title: z.string(),
  summary: z.string(),
  whyNow: z.string(),
  contentOutline: z.array(z.string().min(20)).min(3).max(3),
});

const regeneratedNewSchema = z.object({
  genre: z.string(),
  eyebrow: z.string(),
  title: z.string(),
  summary: z.string(),
  opportunityReason: z.string(),
  pitch: z.string(),
  contentOutline: z.array(z.string().min(20)).min(4).max(4),
});

const regeneratedExistingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['genre', 'eyebrow', 'title', 'summary', 'whyNow', 'contentOutline'],
  properties: {
    genre: { type: 'string' },
    eyebrow: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    whyNow: { type: 'string' },
    contentOutline: {
      type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', minLength: 20 },
    },
  },
} as const;

const regeneratedNewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['genre', 'eyebrow', 'title', 'summary', 'opportunityReason', 'pitch', 'contentOutline'],
  properties: {
    genre: { type: 'string' },
    eyebrow: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    opportunityReason: { type: 'string' },
    pitch: { type: 'string' },
    contentOutline: {
      type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', minLength: 20 },
    },
  },
} as const;

type RankedSimilarRelease = Pick<
  SimilarRelease,
  'companyName' | 'title' | 'genre' | 'summary' | 'pageView' | 'likeCount' | 'sourceUrl' | 'imageUrl'
> & { similarity: number };

function promptSimilarExamples(examples: RankedSimilarRelease[]) {
  return examples.map((example) => ({
    companyName: example.companyName,
    title: example.title,
    genre: example.genre,
    summary: example.summary,
    pageView: example.pageView,
    likeCount: example.likeCount,
    similarity: example.similarity,
  }));
}

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
              'あなたは中小企業の広報担当と一緒に企画会議をする編集者です。完成原稿ではなく、担当者がそのまま会議に出せる簡潔な企画メモを書いてください。自社の過去配信を活かした企画4件と、過去に扱っていないテーマの企画3件を日本語で提案します。3件の新規企画は互いに異なるジャンルと取材対象にしてください。recommendedFocusがexistingなら過去記事の続報を優先し、newなら既存記事と内容が重ならない企画にします。generationConditionsの読者・目的・文体・追加情報を反映してください。タイトルは25〜55文字を目安に、誰の何を扱う記事かが一読で分かる普通の日本語にします。「物語」「舞台裏」「ひもとく」「新たな可能性」「未来への一歩」「挑戦」「想い」「価値を届ける」「会社らしさ」「〜なのでしょうか」などの抽象的な決まり文句や、過度な体言止め、煽り表現は使いません。元記事のタイトルをそのまま長く連結せず、必要な主題だけを短く使います。summaryは誰に何を聞くかを1〜2文、whyNowとopportunityReasonは入力中の具体的な根拠を1つ挙げて短く書きます。pitchは社内の同僚へ説明するような自然な2〜3文にします。各contentOutlineは「見出し｜記事に入れる内容」の形式とし、「紹介します」「具体化します」を繰り返さず、取材で確認する内容を具体的に書きます。自社データにない実績・制度・人数・顧客の声は作らず、未確認情報は断定しません。既存企画は実在するsourceReleaseIdを1つずつ指定し、できるだけ異なる過去配信を使います。他社事例は切り口の参考に限り、その社名・商品名・実績を自社の事実にしません。',
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
              similarExamples: promptSimilarExamples(similarExamples),
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

async function generateExistingItemCopy(
  context: RecommendationContext,
  source: PastRelease,
  similarExamples: RankedSimilarRelease[],
  options: RecommendationGenerationOptions,
  currentTitle: string,
) {
  const payload = await openAiRequest('responses', {
    model: config.OPENAI_TEXT_MODEL,
    store: false,
    input: [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: 'あなたは中小企業の広報担当と企画を考える編集者です。指定された過去配信を元に、現在案とは異なる続報企画を1件だけ作ってください。完成原稿ではなく簡潔な企画メモにします。タイトルは誰の何を扱うかが分かる普通の日本語にし、抽象的な決まり文句や未確認の実績は使いません。contentOutlineは「見出し｜記事に入れる内容」の形式で3件にしてください。他社事例は切り口の参考に限り、その社名・商品名・実績を自社の事実にしません。',
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'input_text',
          text: JSON.stringify({
            company: context.company,
            sourceRelease: source,
            similarExamples: promptSimilarExamples(similarExamples),
            currentTitle,
            generationConditions: options,
          }),
        }],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'regenerated_existing_recommendation',
        strict: true,
        schema: regeneratedExistingJsonSchema,
      },
    },
  });
  return regeneratedExistingSchema.parse(JSON.parse(extractResponseText(payload)));
}

async function generateNewItemCopy(
  context: RecommendationContext,
  options: RecommendationGenerationOptions,
  excludedTitles: string[],
) {
  const payload = await openAiRequest('responses', {
    model: config.OPENAI_TEXT_MODEL,
    store: false,
    input: [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: 'あなたは中小企業の広報担当と企画を考える編集者です。過去配信と除外タイトルに重ならない、新しい切り口の企画を1件だけ作ってください。完成原稿ではなく簡潔な企画メモにします。タイトルは誰の何を扱うかが分かる普通の日本語にし、抽象的な決まり文句や未確認の実績は使いません。contentOutlineは「見出し｜記事に入れる内容」の形式で4件にしてください。',
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'input_text',
          text: JSON.stringify({
            company: context.company,
            pastReleases: context.pastReleases.slice(0, 20).map(({ title, genre, summary }) => ({ title, genre, summary })),
            excludedTitles,
            generationConditions: options,
          }),
        }],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'regenerated_new_recommendation',
        strict: true,
        schema: regeneratedNewJsonSchema,
      },
    },
  });
  return regeneratedNewSchema.parse(JSON.parse(extractResponseText(payload)));
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

async function matchReferenceExamples(
  suggestions: Array<{ genre: string; title: string; summary: string; contentOutline: string[] }>,
  candidates: RankedSimilarRelease[],
): Promise<Array<ReferenceExample | undefined>> {
  if (suggestions.length === 0 || candidates.length === 0) return suggestions.map(() => undefined);
  const suggestionTexts = suggestions.map((suggestion) =>
    [suggestion.genre, suggestion.title, suggestion.summary, ...suggestion.contentOutline].join('\n'),
  );
  const candidateTexts = candidates.map((candidate) =>
    [candidate.genre, candidate.title, candidate.summary].join('\n'),
  );
  const vectors = await createCachedEmbeddings([...suggestionTexts, ...candidateTexts]);
  const suggestionVectors = vectors.slice(0, suggestions.length);
  const candidateVectors = vectors.slice(suggestions.length);

  return suggestionVectors.map((suggestionVector) => {
    const best = candidates.reduce<{ candidate: RankedSimilarRelease; similarity: number } | undefined>(
      (current, candidate, index) => {
        const similarity = cosineSimilarity(suggestionVector, candidateVectors[index] ?? []);
        if (!current || similarity > current.similarity) return { candidate, similarity };
        return current;
      },
      undefined,
    );
    return best ? toReferenceExample(best.candidate) : undefined;
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
      sourceUrl: release.sourceUrl,
      imageUrl: release.imageUrl,
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
      version: 6,
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
    const referenceExamples = await matchReferenceExamples(generated.existingSuggestions, similarExamples);
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
          sourceImageUrl: source.imageUrl,
          referenceExample: referenceExamples[index],
          similarity: similarities[index] ?? 0,
        };
      })
      .sort((left, right) => right.similarity - left.similarity);
    const dashboard: RecommendationDashboard = {
      company: loaded.context.company,
      stats: dashboardStats(loaded.context),
      sourceReleases: sourceReleases(loaded.context),
      existingSuggestions,
      newOpportunities: generated.newOpportunities,
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
    const dashboard = buildTemplateDashboard(
      loaded,
      options,
      'AI生成に失敗したため、簡易提案を表示しています。時間をおいて再生成してください。',
    );
    return persistDashboard(cacheKey, companyId, dashboard, options);
  }
}

export async function regenerateRecommendationItem(companyId: string, input: unknown) {
  const request = itemRegenerationSchema.parse(input);
  const options = normalizeGenerationOptions(request.conditions);
  const loaded = await loadContext(companyId);
  const generatedAt = new Date().toISOString();

  if (request.layer === 'existing') {
    const source = loaded.context.pastReleases.find((release) => release.id === request.sourceReleaseId)
      ?? loaded.context.pastReleases[0];
    if (!source) throw new Error('No source release is available');

    const templateItem = () => {
      const candidates = genericSuggestions({ ...loaded.context, pastReleases: [source] });
      const candidate = candidates.find((item) => item.title !== request.currentTitle) ?? candidates[0]!;
      return { ...candidate, id: `release-${source.id}-${randomUUID()}` };
    };

    if (!config.OPENAI_API_KEY) {
      return { layer: 'existing' as const, item: templateItem(), mode: 'template' as const, generatedAt };
    }

    try {
      const similarExamples = await rankSimilarExamples(loaded.context);
      const generated = await generateExistingItemCopy(
        loaded.context,
        source,
        similarExamples,
        options,
        request.currentTitle,
      );
      const id = `release-${source.id}-${randomUUID()}`;
      const [similarity = 0] = await scoreSuggestions(
        [{ ...generated, id, sourceReleaseId: source.id }],
        [source],
      );
      const [referenceExample] = await matchReferenceExamples([generated], similarExamples);
      const item: ExistingSuggestion = {
        ...generated,
        id,
        sourceReleaseId: source.id,
        sourceTitle: source.title,
        sourceUrl: source.sourceUrl,
        sourceImageUrl: source.imageUrl,
        referenceExample,
        similarity,
      };
      return { layer: 'existing' as const, item, mode: 'openai' as const, generatedAt };
    } catch (error) {
      console.error('Existing recommendation item regeneration failed; serving a template item.', error);
      return {
        layer: 'existing' as const,
        item: templateItem(),
        mode: 'template' as const,
        generatedAt,
        generationNotice: 'AI生成に失敗したため、この案は簡易提案で作り直しました。',
      };
    }
  }

  const excludedTitles = Array.from(new Set(
    [...request.excludedTitles, request.currentTitle].filter(Boolean),
  ));
  const templateItem = () => {
    const candidates = genericNewOpportunities(loaded.context);
    const candidate = candidates.find((item) => !excludedTitles.includes(item.title))
      ?? candidates.find((item) => item.title !== request.currentTitle)
      ?? candidates[0]!;
    return { ...candidate, id: `new-${randomUUID()}` };
  };

  if (!config.OPENAI_API_KEY) {
    return { layer: 'new' as const, item: templateItem(), mode: 'template' as const, generatedAt };
  }

  try {
    const generated = await generateNewItemCopy(loaded.context, options, excludedTitles);
    const item: NewOpportunity = { ...generated, id: `new-${randomUUID()}` };
    return { layer: 'new' as const, item, mode: 'openai' as const, generatedAt };
  } catch (error) {
    console.error('New recommendation item regeneration failed; serving a template item.', error);
    return {
      layer: 'new' as const,
      item: templateItem(),
      mode: 'template' as const,
      generatedAt,
      generationNotice: 'AI生成に失敗したため、この案は簡易提案で作り直しました。',
    };
  }
}
