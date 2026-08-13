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
    dataSource?: 'database' | 'mock';
    similarityMethod: string;
  };
};

export const fallbackDashboard: RecommendationDashboard = {
  company: {
    id: '900001',
    name: '株式会社デモ青空',
    initials: '青',
    industry: '情報通信業',
    location: '東京都渋谷区',
    founded: '2018年',
    capital: '5,000万円',
    website: 'https://aozora.example',
    description: 'AIとデータを活用した架空の業務支援サービスを開発するデモ企業です。',
  },
  stats: { releasesAnalyzed: 5, genresFound: 4, lastPublished: '1日前' },
  existingSuggestions: [
    {
      id: 'sorapress-origin',
      genre: '開発秘話',
      eyebrow: '過去記事 × 開発ストーリー',
      title: '企画メモが記事になるまで。広報AI「SoraPress」β版を支えた試行錯誤',
      summary:
        '機能紹介だけでは見えなかった、企画メモから構成案を生み出すまでの改善過程を開発チームの言葉でたどります。',
      whyNow: 'β版提供開始の記事は12万PVを超えており、読者の関心を開発の背景へ広げやすいタイミングです。',
      contentOutline: [
        '広報担当者の「何から書けばいい？」が出発点',
        '企画メモを構成案へ変えるまでの検証',
        '効果測定まで一つの画面に込めた理由',
      ],
      sourceTitle: '【架空サービス】広報AIアシスタント「SoraPress」β版を提供開始',
      similarity: 95,
    },
    {
      id: 'workshop-voices',
      genre: 'イベントレポート',
      eyebrow: '過去記事 × 参加者の声',
      title: '「広報ネタがない」が変わった日。デモPR勉強会2026の学びと対話',
      summary:
        '開催告知を参加者視点のレポートへ展開。実践ワークショップで生まれた気づきや担当者同士の対話を次回開催につなげます。',
      whyNow: '告知だけで終わらせず、参加価値を具体化することで次回イベントやコミュニティ形成に活用できます。',
      contentOutline: [
        '参加者が抱えていた発信の悩み',
        '架空事例ワークで見つけた自社の切り口',
        '勉強会の先に育てたい広報担当者のつながり',
      ],
      sourceTitle: '全国の広報担当者向け「デモPR勉強会2026」を東京・オンラインで開催',
      similarity: 90,
    },
    {
      id: 'survey-insight',
      genre: '調査インサイト',
      eyebrow: '過去記事 × データ解説',
      title: '72％の「効率化実感」、その先へ。400人調査から読む広報AIの現在地',
      summary:
        '調査結果の発表から一歩進み、文章作成・情報収集・効果測定で生成AIがどう使い分けられているかを解説します。',
      whyNow: '3.5万PVの調査結果を実務目線で読み直し、継続的に参照される解説コンテンツへ発展できます。',
      contentOutline: ['72％が実感した効率化の内訳', '活用が進む業務・進まない業務', '広報担当者が次に備えること'],
      sourceTitle: '生成AIの広報活用に関する実態調査2026、担当者の72％が業務効率化を実感',
      similarity: 92,
    },
    {
      id: 'growth-vision',
      genre: '経営・ビジョン',
      eyebrow: '過去記事 × これからの会社',
      title: '資金調達のその先へ。デモ青空が描く「すべての企業に広報の力を」',
      summary:
        '調達額の発表ではなく、開発・採用・地域展開を通じて解決したい広報課題と今後の意思を代表者の言葉で伝えます。',
      whyNow: '資金調達記事に書かれた三つの投資領域を、顧客と社会にとっての価値へ言い換えられます。',
      contentOutline: ['創業時に感じた中小企業の広報課題', '開発・採用・地域展開に投資する理由', '5年後に実現したい広報のあり方'],
      sourceTitle: '株式会社デモ青空、事業拡大に向けた架空の資金調達を実施',
      similarity: 84,
    },
  ],
  newOpportunity: {
    id: 'customer-success',
    genre: '導入企業・伴走支援',
    eyebrow: 'まだ発信していない魅力',
    title: 'AIを入れて終わりにしない。広報担当者の「最初の1本」に伴走する人たち',
    summary:
      'SoraPressの機能ではなく、導入企業が自社の魅力を見つけ、最初の発信を形にするまでのサポートを主役にした企画です。',
    opportunityReason:
      'seed.sqlの過去5本は、サービス・イベント・調査・資金調達が中心。カスタマーサポートへの投資は示されていますが、顧客に伴走する人やプロセスはまだ発信されていません。',
    pitch:
      'プレスリリースを書いた経験がない担当者は、AIがあっても自社の何を伝えるべきか迷います。デモ青空の伴走チームは、答えを代わりに書くのではなく、担当者との対話から発信の種を見つけます。最初の企画メモが一本の記事になるまでを、導入企業と担当者の両方の視点から紹介します。',
    contentOutline: [
      'きっかけ｜AIがあっても書き始められない担当者の声',
      '伴走｜対話から企業らしい発信テーマを見つけるまで',
      '変化｜最初の一本が社内の情報共有を変える',
      'これから｜地域や業種を越えて広報の選択肢を広げる',
    ],
    interviewQuestions: [
      '導入直後、担当者が最も迷っていたことは何ですか？',
      'AIではなく人が伴走する価値はどこにありますか？',
      '最初の一本を出した後、社内にどんな変化がありましたか？',
    ],
  },
  meta: {
    generatedAt: new Date().toISOString(),
    mode: 'demo',
    similarityMethod: 'デモ用の埋め込み類似度',
  },
};
