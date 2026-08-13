import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

export type DocumentTarget = 'word' | 'google_docs';

export type ProposalDocument = {
  title: string;
  contentOutline: string[];
};

function text(value: string, options: { bold?: boolean; color?: string; size?: number } = {}) {
  return new TextRun({
    text: value,
    font: 'Arial',
    bold: options.bold,
    color: options.color,
    size: options.size,
  });
}

function heading(value: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    spacing: { before: 400, after: 120 },
    children: [text(value, { bold: false, color: '000000', size: 40 })],
  });
}

function numberedItem(value: string) {
  return new Paragraph({
    numbering: { reference: 'proposal-outline', level: 0 },
    spacing: { after: 80, line: 276 },
    children: [text(value, { size: 22 })],
  });
}

export async function buildProposalDocx(
  proposal: ProposalDocument,
  target: DocumentTarget,
): Promise<Buffer> {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [text(proposal.title, { size: 52, color: '000000' })],
    }),
    heading('おすすめ構成案・具体例'),
    ...proposal.contentOutline.map(numberedItem),
  ];

  const document = new Document({
    creator: 'KIKKAKE',
    title: proposal.title,
    description: target === 'google_docs' ? 'Google Docs import-ready document' : 'Microsoft Word document',
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 22, color: '000000' } },
        heading1: {
          run: { font: 'Arial', size: 40, color: '000000', bold: false },
          paragraph: { spacing: { before: 400, after: 120 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'proposal-outline',
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 360 },
                spacing: { after: 80, line: 276 },
              },
            },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12_240, height: 15_840 },
          margin: { top: 1_440, right: 1_440, bottom: 1_440, left: 1_440, header: 708, footer: 708 },
        },
      },
      children: paragraphs,
    }],
  });

  return Packer.toBuffer(document);
}
