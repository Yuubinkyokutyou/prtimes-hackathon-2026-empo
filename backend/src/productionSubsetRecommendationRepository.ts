import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { CompanyNotFoundError } from './recommendationRepository.js';
import type {
  CompanyProfile,
  CompanySummary,
  PastRelease,
  RecommendationContext,
  RecommendationContextProvider,
  SimilarRelease,
} from './recommendationTypes.js';

type CsvRecord = { [key: string]: string };

function value(row: CsvRecord, column: string): string {
  return row[column] ?? '';
}

type LoadedSubset = {
  companies: Map<string, CompanyProfile>;
  releases: Array<PastRelease & { companyId: string; companyName: string }>;
  releasesByCompany: Map<string, PastRelease[]>;
};

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(directory: string, fileName: string): CsvRecord[] {
  const filePath = path.join(directory, fileName);
  if (!existsSync(filePath)) throw new Error(`production_subset CSV is missing: ${filePath}`);

  const rows = parseCsv(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
  const header = rows.shift();
  if (!header) throw new Error(`production_subset CSV has no header: ${filePath}`);
  return rows.map((values) =>
    Object.fromEntries(header.map((column, index) => [column, values[index] === 'NULL' ? '' : (values[index] ?? '')])),
  );
}

function initialsFor(name: string): string {
  const normalized = name
    .replace(/^株式会社\s*/u, '')
    .replace(/^合同会社\s*/u, '')
    .replace(/^一般社団法人\s*/u, '')
    .trim();
  return Array.from(normalized)[0] ?? '企';
}

function formatCapital(value: string): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return '—';
  // The production export stores capital in ten-thousand-yen units.
  return `${new Intl.NumberFormat('ja-JP').format(numericValue * 10_000)}円`;
}

function formatFounded(value: string): string {
  const year = value.match(/^\d{4}/u)?.[0];
  return year ? `${year}年` : value || '—';
}

function numericValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultDirectory(): string {
  return config.PRODUCTION_SUBSET_DIRECTORY
    ? path.resolve(config.PRODUCTION_SUBSET_DIRECTORY)
    : fileURLToPath(new URL('../../database/production_subset/csv/', import.meta.url));
}

export class ProductionSubsetRecommendationContextProvider
implements RecommendationContextProvider {
  private loaded?: LoadedSubset;

  constructor(private readonly directory = defaultDirectory()) {}

  private load(): LoadedSubset {
    if (this.loaded) return this.loaded;

    const industries = new Map(
      readCsv(this.directory, '03_industry.csv').map((row) => [value(row, 'industry_id'), value(row, 'industry_name')]),
    );
    const releaseTypes = new Map(
      readCsv(this.directory, '05_release_type.csv').map((row) => [value(row, 'release_type_id'), value(row, 'release_type_name')]),
    );
    const keywords = new Map(
      readCsv(this.directory, '07_keyword.csv').map((row) => [value(row, 'keyword_id'), value(row, 'keyword_name')]),
    );
    const companies = new Map<string, CompanyProfile>();
    for (const row of readCsv(this.directory, '09_company.csv')) {
      const companyId = value(row, 'company_id');
      const companyName = value(row, 'company_name');
      companies.set(companyId, {
        id: companyId,
        name: companyName,
        initials: initialsFor(companyName),
        industry: industries.get(value(row, 'industry_id')) || 'その他',
        location: value(row, 'address') || '—',
        founded: formatFounded(value(row, 'foundation_date')),
        capital: formatCapital(value(row, 'capital')),
        website: value(row, 'url'),
        description: value(row, 'description') || `${companyName}の企業情報と過去配信を分析しています。`,
      });
    }

    const statistics = new Map(
      readCsv(this.directory, '14_release_statistic.csv').map((row) => [
        `${value(row, 'company_id')}:${value(row, 'release_id')}`,
        { pageView: numericValue(value(row, 'page_view')), likeCount: numericValue(value(row, 'like_count')) },
      ]),
    );
    const releaseKeywords = new Map<string, string[]>();
    for (const row of readCsv(this.directory, '12_release_keyword.csv')) {
      const key = `${value(row, 'company_id')}:${value(row, 'release_id')}`;
      const keyword = keywords.get(value(row, 'keyword_id'));
      if (!keyword) continue;
      const values = releaseKeywords.get(key) ?? [];
      values.push(keyword);
      releaseKeywords.set(key, values);
    }

    const now = Date.now();
    const releases: LoadedSubset['releases'] = [];
    const releasesByCompany = new Map<string, PastRelease[]>();
    for (const row of readCsv(this.directory, '10_release.csv')) {
      const companyId = value(row, 'company_id');
      const releaseId = value(row, 'release_id');
      const company = companies.get(companyId);
      const timestamp = Date.parse(value(row, 'created_at'));
      if (!company || !Number.isFinite(timestamp) || timestamp > now) continue;

      const key = `${companyId}:${releaseId}`;
      const statistic = statistics.get(key);
      const release: PastRelease = {
        id: releaseId,
        title: value(row, 'title'),
        genre: releaseTypes.get(value(row, 'release_type_id')) || 'その他',
        summary: value(row, 'lead_paragraph') || value(row, 'subtitle'),
        body: value(row, 'body').slice(0, 4_000),
        publishedAt: new Date(timestamp).toISOString(),
        pageView: statistic?.pageView ?? 0,
        likeCount: statistic?.likeCount ?? 0,
        keywords: releaseKeywords.get(key) ?? [],
      };
      releases.push({ ...release, companyId, companyName: company.name });
      const ownReleases = releasesByCompany.get(companyId) ?? [];
      ownReleases.push(release);
      releasesByCompany.set(companyId, ownReleases);
    }

    for (const ownReleases of releasesByCompany.values()) {
      ownReleases.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
    }

    this.loaded = { companies, releases, releasesByCompany };
    return this.loaded;
  }

  async get(companyId: string): Promise<RecommendationContext> {
    const loaded = this.load();
    const company = loaded.companies.get(companyId);
    const ownReleases = loaded.releasesByCompany.get(companyId) ?? [];
    if (!company || ownReleases.length === 0) throw new CompanyNotFoundError(companyId);

    const candidateReleases = loaded.releases
      .filter((release) => release.companyId !== companyId)
      .sort((left, right) => right.pageView - left.pageView || Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
      .slice(0, 120)
      .map(({ companyId: _companyId, ...release }): SimilarRelease => release);

    return {
      company: structuredClone(company),
      pastReleases: ownReleases.slice(0, 50).map((release) => structuredClone(release)),
      candidateReleases,
    };
  }

  async listCompanies(): Promise<CompanySummary[]> {
    const loaded = this.load();
    return Array.from(loaded.releasesByCompany.entries())
      .map(([companyId, releases]) => ({ company: loaded.companies.get(companyId), releases }))
      .filter((entry): entry is { company: CompanyProfile; releases: PastRelease[] } => Boolean(entry.company))
      .sort(
        (left, right) =>
          right.releases.length - left.releases.length ||
          Date.parse(right.releases[0]?.publishedAt ?? '') - Date.parse(left.releases[0]?.publishedAt ?? ''),
      )
      .map(({ company, releases }) => ({
        id: company.id,
        name: company.name,
        initials: company.initials,
        industry: company.industry,
        releaseCount: releases.length,
      }));
  }
}
