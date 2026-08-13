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

export type ExistingSuggestion = {
  id: string;
  genre: string;
  eyebrow: string;
  title: string;
  summary: string;
  whyNow: string;
  contentOutline: string[];
  sourceTitle: string;
  sourceReleaseId?: string;
  sourceUrl: string;
  sourceEvidence: string;
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
    mode: 'template' | 'openai';
    dataSource: 'production_subset' | 'database';
    similarityMethod: string;
    recommendedFocus: 'existing' | 'new';
    daysSinceLastPublished: number | null;
    generationId: string;
    conditions: RecommendationGenerationOptions;
    saved: boolean;
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
};
