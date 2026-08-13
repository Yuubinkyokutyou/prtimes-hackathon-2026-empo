export type CompanyProfile = {
  id: string;
  name: string;
  initials: string;
  industry: string;
  location: string;
  founded: string;
  capital: string;
  website: string;
  description: string;
};

export type PastRelease = {
  id: string;
  title: string;
  genre: string;
  summary: string;
  body: string;
  publishedAt: string;
  pageView: number;
  likeCount: number;
  keywords: string[];
  sourceUrl: string;
  imageUrl: string;
};

export type SimilarRelease = PastRelease & {
  companyName: string;
};

export type ReferenceExample = Pick<
  SimilarRelease,
  'companyName' | 'title' | 'summary' | 'sourceUrl' | 'imageUrl'
>;

export type RecommendationContext = {
  company: CompanyProfile;
  pastReleases: PastRelease[];
  candidateReleases: SimilarRelease[];
};

export type ExistingSuggestion = {
  id: string;
  genre: string;
  eyebrow: string;
  title: string;
  summary: string;
  whyNow: string;
  contentOutline: string[];
  sourceTitle: string;
  sourceReleaseId: string;
  sourceUrl: string;
  sourceImageUrl: string;
  referenceExample?: ReferenceExample;
  similarity: number;
};

export type RecommendationGenerationOptions = {
  focus: 'auto' | 'existing' | 'new';
  tone: 'standard' | 'formal' | 'friendly' | 'bold';
  audience: string;
  objective: string;
  additionalContext: string;
};

export type NewOpportunity = {
  id: string;
  genre: string;
  eyebrow: string;
  title: string;
  summary: string;
  opportunityReason: string;
  pitch: string;
  contentOutline: string[];
};

export type SourceReleaseSummary = Pick<
  PastRelease,
  'id' | 'title' | 'publishedAt' | 'sourceUrl' | 'pageView'
>;

export type RecommendationDashboard = {
  company: CompanyProfile;
  stats: {
    releasesAnalyzed: number;
    genresFound: number;
    lastPublished: string;
    dataUpdatedAt: string;
  };
  sourceReleases: SourceReleaseSummary[];
  existingSuggestions: ExistingSuggestion[];
  newOpportunities: NewOpportunity[];
  meta: {
    generatedAt: string;
    mode: 'template' | 'openai';
    dataSource: 'production_subset' | 'database';
    similarityMethod: string;
    recommendedFocus: 'existing' | 'new';
    daysSinceLastPublished: number | null;
    generationId: string;
    conditions: RecommendationGenerationOptions;
    saved: boolean;
    generationNotice?: string;
  };
};

export type RecommendationHistoryItem = {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  mode: RecommendationDashboard['meta']['mode'];
  conditions: RecommendationGenerationOptions;
  saved: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CompanySummary = Pick<CompanyProfile, 'id' | 'name' | 'initials' | 'industry'> & {
  releaseCount: number;
  lastPublishedAt: string;
};

export interface RecommendationContextProvider {
  get(companyId: string): Promise<RecommendationContext>;
  listCompanies(): Promise<CompanySummary[]>;
}
