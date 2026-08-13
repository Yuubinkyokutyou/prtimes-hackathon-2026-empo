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
};

export type SimilarRelease = PastRelease & {
  companyName: string;
};

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
  similarity: number;
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
  interviewQuestions: string[];
};

export type RecommendationDashboard = {
  company: CompanyProfile;
  stats: {
    releasesAnalyzed: number;
    genresFound: number;
    lastPublished: string;
  };
  existingSuggestions: ExistingSuggestion[];
  newOpportunity: NewOpportunity;
  meta: {
    generatedAt: string;
    mode: 'demo' | 'openai';
    dataSource: 'production_subset' | 'database' | 'mock';
    similarityMethod: string;
    recommendedFocus: 'existing' | 'new';
    daysSinceLastPublished: number | null;
  };
};

export type CompanySummary = Pick<CompanyProfile, 'id' | 'name' | 'initials' | 'industry'> & {
  releaseCount: number;
};

export interface RecommendationContextProvider {
  get(companyId: string): Promise<RecommendationContext>;
  listCompanies(): Promise<CompanySummary[]>;
}
