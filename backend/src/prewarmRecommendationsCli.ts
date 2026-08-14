import type { RecommendationDashboard } from './recommendationTypes.js';

export type PrewarmArguments = {
  companyIds: string[];
  refresh: boolean;
  help: boolean;
};

export const prewarmUsage = `Usage: npm run recommendations:prewarm -- --company-id <id> [--company-id <id> ...] [--refresh]

Options:
  --company-id <id>  PostgreSQL company ID to prewarm. Repeat for multiple companies.
  --refresh          Regenerate even when a PostgreSQL cache entry already exists.
  --help             Show this help.`;

export function parsePrewarmArguments(args: string[]): PrewarmArguments {
  const companyIds: string[] = [];
  let refresh = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--refresh') {
      refresh = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }

    const inlineCompanyId = argument.match(/^--company-id=(.+)$/)?.[1];
    if (argument === '--company-id' || inlineCompanyId !== undefined) {
      const value = inlineCompanyId ?? args[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
        throw new Error('--company-id must be a positive integer');
      }
      if (!companyIds.includes(value)) companyIds.push(value);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!help && companyIds.length === 0) {
    throw new Error('At least one --company-id is required');
  }
  return { companyIds, refresh, help };
}

export function formatRecommendation(dashboard: RecommendationDashboard): string {
  const lines = [
    `Company: ${dashboard.company.name} (${dashboard.company.id})`,
    `Generated: ${dashboard.meta.generatedAt} / ${dashboard.meta.mode}`,
    'Existing-release suggestions:',
  ];

  dashboard.existingSuggestions.forEach((suggestion, index) => {
    lines.push(`  ${index + 1}. ${suggestion.title}`);
    lines.push(`     ${suggestion.summary}`);
  });
  lines.push('New opportunities:');
  dashboard.newOpportunities.forEach((opportunity, index) => {
    lines.push(`  ${index + 1}. ${opportunity.title}`);
    lines.push(`     ${opportunity.summary}`);
  });
  return lines.join('\n');
}
