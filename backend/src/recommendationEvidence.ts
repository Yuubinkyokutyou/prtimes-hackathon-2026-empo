type ReleaseEvidenceInput = {
  title?: string | null;
  subtitle?: string | null;
  leadParagraph?: string | null;
  body?: string | null;
};

function decodeNumericEntity(entity: string): string {
  const hexadecimal = entity[0]?.toLowerCase() === 'x';
  const value = Number.parseInt(hexadecimal ? entity.slice(1) : entity, hexadecimal ? 16 : 10);
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return ' ';
  return String.fromCodePoint(value);
}

export function plainText(value?: string | null): string {
  return (value ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&(nbsp|ensp|emsp|thinsp);/giu, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (_match, entity: string) => decodeNumericEntity(entity))
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncate(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, maxLength - 1).join('').replace(/[\s、。,.!！?？]+$/u, '')}…`;
}

export function evidenceFromSourceTitle(sourceTitle?: string | null): string {
  const title = truncate(plainText(sourceTitle) || '過去配信', 140);
  return `過去配信「${title}」を着想元に、発表の背景や公開後の変化を追加取材で確かめる企画です。`;
}

export function buildReleaseEvidence(input: ReleaseEvidenceInput): string {
  const evidence = [input.leadParagraph, input.subtitle, input.body]
    .map(plainText)
    .find(Boolean);
  return evidence ? truncate(evidence, 320) : evidenceFromSourceTitle(input.title);
}
