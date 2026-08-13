import { z } from 'zod';
import type { RecommendationDashboard } from './recommendationTypes.js';

const generationOptionsSchema = z.object({
  focus: z.enum(['auto', 'existing', 'new']),
  tone: z.enum(['standard', 'formal', 'friendly', 'bold']),
  audience: z.string().max(200),
  objective: z.string().max(300),
  additionalContext: z.string().max(2_000),
});

const suggestionSchema = z.object({
  id: z.string().min(1),
  genre: z.string().min(1).max(100),
  eyebrow: z.string().max(200),
  title: z.string().min(1).max(500),
  summary: z.string().max(4_000),
  whyNow: z.string().max(4_000),
  contentOutline: z.array(z.string().max(4_000)).max(20),
  sourceTitle: z.string().max(1_000),
  sourceReleaseId: z.string().max(100),
  sourceUrl: z.string().max(2_000),
  sourceEvidence: z.string().trim().min(1).max(8_000),
  similarity: z.number().min(0).max(100),
});

export const recommendationDashboardSchema = z.object({
  company: z.object({
    id: z.string(),
    name: z.string().min(1).max(500),
    initials: z.string().max(20),
    industry: z.string().max(500),
    location: z.string().max(1_000),
    founded: z.string().max(100),
    capital: z.string().max(100),
    website: z.string().max(2_000),
    description: z.string().max(10_000),
  }),
  stats: z.object({
    releasesAnalyzed: z.number().int().nonnegative(),
    genresFound: z.number().int().nonnegative(),
    lastPublished: z.string(),
  }),
  existingSuggestions: z.array(suggestionSchema).max(20),
  newOpportunity: z.object({
    id: z.string(),
    genre: z.string().max(100),
    eyebrow: z.string().max(200),
    title: z.string().min(1).max(500),
    summary: z.string().max(4_000),
    opportunityReason: z.string().max(8_000),
    pitch: z.string().max(12_000),
    contentOutline: z.array(z.string().max(4_000)).max(20),
    interviewQuestions: z.array(z.string().max(2_000)).max(20),
  }),
  meta: z.object({
    generatedAt: z.string(),
    mode: z.enum(['template', 'openai']),
    dataSource: z.enum(['production_subset', 'database']),
    similarityMethod: z.string(),
    recommendedFocus: z.enum(['existing', 'new']),
    daysSinceLastPublished: z.number().int().nonnegative().nullable(),
    generationId: z.string().uuid(),
    conditions: generationOptionsSchema,
    saved: z.boolean(),
  }),
});

export function parseRecommendationDashboard(input: unknown): RecommendationDashboard {
  return recommendationDashboardSchema.parse(input) as RecommendationDashboard;
}
