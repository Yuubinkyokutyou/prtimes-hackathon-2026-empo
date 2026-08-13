const CAPITAL_LIMIT_TEN_THOUSAND_YEN = {
  manufacturingAndOther: 30_000,
  wholesale: 10_000,
  retailAndService: 5_000,
} as const;

const excludedIndustries = new Set([
  '官公庁・地方自治体',
  '財団法人・社団法人・宗教法人',
]);

function capitalLimitFor(industry: string): number {
  if (industry === '商業（卸売業、小売業）') {
    // The source data combines wholesale and retail. Use the stricter retail
    // threshold so the estimate does not overstate eligibility.
    return CAPITAL_LIMIT_TEN_THOUSAND_YEN.retailAndService;
  }
  if (
    industry === 'サービス業' ||
    industry === '金融・保険業' ||
    industry === '不動産業' ||
    industry === '飲食店・宿泊業' ||
    industry === '医療・福祉' ||
    industry === '教育・学習支援業'
  ) {
    return CAPITAL_LIMIT_TEN_THOUSAND_YEN.retailAndService;
  }
  return CAPITAL_LIMIT_TEN_THOUSAND_YEN.manufacturingAndOther;
}

/**
 * Estimates SME scale using only the capital criterion from the SME Basic Act.
 * Capital in the source company table is stored in units of ten thousand yen.
 */
export function isSmeByCapital(industry: string, capitalTenThousandYen: number): boolean {
  if (!Number.isFinite(capitalTenThousandYen) || capitalTenThousandYen <= 0) return false;
  if (excludedIndustries.has(industry)) return false;
  return capitalTenThousandYen <= capitalLimitFor(industry);
}
