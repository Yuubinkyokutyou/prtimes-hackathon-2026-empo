import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  fallbackDashboard,
  type CompanySummary,
  type ExistingSuggestion,
  type RecommendationDashboard,
} from './data';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

type IconName =
  | 'apps' | 'document' | 'media' | 'book' | 'chart' | 'clip' | 'company'
  | 'menu' | 'bell' | 'user' | 'phone' | 'form' | 'sparkles' | 'arrow'
  | 'file' | 'lightbulb' | 'search' | 'check' | 'building' | 'map' | 'calendar';

const iconPaths: Record<IconName, ReactNode> = {
  apps: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  document: <><rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M8 8h8M8 12h8M8 16h6"/></>,
  media: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h7"/></>,
  book: <><path d="M3 5.5c3.8-1.1 6.8-.5 9 1.6v13c-2.2-2.1-5.2-2.7-9-1.6zM21 5.5c-3.8-1.1-6.8-.5-9 1.6v13c2.2-2.1 5.2-2.7 9-1.6z"/></>,
  chart: <><path d="M3 19h18"/><path d="m5 15 4-5 4 3 5-8"/><circle cx="5" cy="15" r="1"/><circle cx="9" cy="10" r="1"/><circle cx="13" cy="13" r="1"/><circle cx="18" cy="5" r="1"/></>,
  clip: <path d="M8.2 12.8 14 7a3.2 3.2 0 0 1 4.5 4.5l-7.7 7.7a5 5 0 0 1-7.1-7.1l8.1-8.1"/>,
  company: <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/></>,
  menu: <><path d="M4 6h13M4 12h10M4 18h13"/><path d="m19 9-3 3 3 3"/></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8"/><path d="M10 21h4"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/><circle cx="12" cy="12" r="10"/></>,
  phone: <path d="M6.6 2.8 9 8 6.4 9.6c1.6 3.5 4.5 6.4 8 8l1.6-2.7 5.2 2.4-1 3.6c-.2.8-1 1.3-1.8 1.2C9.8 21 3 14.2 1.9 5.6c-.1-.8.4-1.6 1.2-1.8z"/>,
  form: <><path d="M13 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/><path d="m12 15 9-9-3-3-9 9-1 4z"/></>,
  sparkles: <><path d="m12 2 1.4 4.1L17.5 7.5l-4.1 1.4L12 13l-1.4-4.1-4.1-1.4 4.1-1.4z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/><path d="m5 14 .7 1.8 1.8.7-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7z"/></>,
  arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h5"/></>,
  lightbulb: <><path d="M9 18h6M10 22h4"/><path d="M8.3 15.2A7 7 0 1 1 15.7 15.2c-.9.7-1.4 1.5-1.5 2.3h-4.4c-.1-.8-.6-1.6-1.5-2.3Z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  building: <><path d="M4 21h16M6 21V7l6-3v17M12 9h6v12"/></>,
  map: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
};

function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

const notices = [
  { title: 'コンテンツ掲載基準を更新しました', body: '「日本初」「No.1」等の最上級表現の改定や、メディアタイアップ広告に関する基準の新設など、コンテンツ掲載基準を更新しました。ご配信前に、ぜひ', link: '改定・新設のご案内', tail: 'をご確認いただけますと幸いです。' },
  { title: 'WebクリッピングでSNS投稿の取得が可能になりました', body: 'Webクリッピングのクリップ調査で、指定したキーワードに基づきSNS（X、Instagram、TikTok）上の投稿を毎日自動で取得し、一覧で確認できるようになりました。Web記事だけでなく、SNS上の生活者の反響もまとめてご確認いただけます。', note: '※2026年10月14日までは、現在のクリップ調査の料金（1クリップ月額5,000円）でご利用いただけます。', link: 'SNS投稿取得機能の詳細を見る' },
];

function Sidebar({ analysisOpen, setAnalysisOpen, page, setPage, mobileOpen }: {
  analysisOpen: boolean; setAnalysisOpen: (open: boolean) => void;
  page: 'dashboard' | 'recommend'; setPage: (page: 'dashboard' | 'recommend') => void; mobileOpen: boolean;
}) {
  const items: Array<{ label: string; icon: IconName }> = [
    { label: 'プレスリリース', icon: 'document' }, { label: 'メディアリスト', icon: 'media' }, { label: 'ストーリー', icon: 'book' },
  ];
  return <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}><nav aria-label="メインメニュー">
    <button className={`nav-item nav-item--dashboard ${page === 'dashboard' ? 'is-active' : ''}`} onClick={() => setPage('dashboard')}><Icon name="apps"/><span>ダッシュボード</span></button>
    {items.map((item) => <button className="nav-item" key={item.label}><Icon name={item.icon}/><span>{item.label}</span><span className="nav-arrow">›</span></button>)}
    <button className={`nav-item ${analysisOpen ? 'is-expanded' : ''}`} aria-expanded={analysisOpen} onClick={() => setAnalysisOpen(!analysisOpen)}><Icon name="chart"/><span>分析データ</span><span className="nav-arrow nav-arrow--chevron">⌄</span></button>
    {analysisOpen && <div className="subnav"><button>レポート</button><button>提携オンラインメディア</button><button>ソーシャル</button><button>広告換算ツール</button><button className={page === 'recommend' ? 'is-current' : ''} onClick={() => setPage('recommend')}><Icon name="sparkles" size={19}/>レコメンド<span className="new-badge">NEW</span></button></div>}
    <button className="nav-item"><Icon name="clip"/><span>Webクリッピング</span><span className="nav-arrow">›</span></button>
    <button className="nav-item"><Icon name="company"/><span>企業ページ</span><span className="nav-arrow">›</span></button>
  </nav></aside>;
}

function Header({ toggleMenu }: { toggleMenu: () => void }) {
  return <header className="header">
    <div className="brand" aria-label="PR TIMES">PR<span>ΤΙΜΕS</span></div>
    <button className="mobile-menu" onClick={toggleMenu} aria-label="メニューを開く"><Icon name="menu"/></button>
    <div className="header-actions"><button className="create-button">メディアリスト新規作成</button><button className="create-button create-button--primary">プレスリリース新規作成</button></div>
    <div className="support"><span className="support-label">サポートデスクはこちら</span><div className="support-row"><Icon name="phone" size={25}/><strong>03-6625-4684</strong></div></div>
    <button className="contact-button"><Icon name="form" size={23}/>問い合わせフォーム</button><button className="icon-button" aria-label="通知"><Icon name="bell" size={26}/></button>
    <div className="account"><div>株式会社ハッカソン</div><small>企業ID：99125</small></div><button className="account-icon" aria-label="アカウント"><Icon name="user" size={44}/></button>
  </header>;
}

function Dashboard() {
  const [openNotices, setOpenNotices] = useState([true, true]);
  const [projectVisible, setProjectVisible] = useState(true);
  const [projectOpen, setProjectOpen] = useState(false);
  return <><div className="breadcrumb">ダッシュボード</div><div className="content"><h1>ダッシュボード</h1>
    {projectVisible && <section className="project-bar"><button className="project-toggle" onClick={() => setProjectOpen(!projectOpen)} aria-expanded={projectOpen}><strong>テスト4</strong><span>{projectOpen ? '⌃' : '⌄'}</span></button><button className="close-button" onClick={() => setProjectVisible(false)} aria-label="閉じる">×</button>{projectOpen && <p className="project-detail">現在選択中のプロジェクトです</p>}</section>}
    <div className="notice-list">{notices.map((notice, index) => <article className="notice-card" key={notice.title}><div className="notice-heading"><button onClick={() => setOpenNotices((values) => values.map((value, i) => i === index ? !value : value))} aria-expanded={openNotices[index]}><h2>{notice.title}</h2><span>{openNotices[index] ? '⌃' : '⌄'}</span></button><button className="close-button" aria-label="閉じる">×</button></div>{openNotices[index] && <div className="notice-body"><p>{notice.body}{index === 0 && <><a href="#guide">{notice.link}</a>{notice.tail}</>}</p>{notice.note && <p>{notice.note}</p>}{index === 1 && <a id="guide" href="#details">{notice.link}</a>}</div>}</article>)}</div>
  </div></>;
}

function DetailModal({ suggestion, onClose, onCopy }: { suggestion: ExistingSuggestion; onClose: () => void; onCopy: () => void }) {
  return <div className="recommend-overlay" onMouseDown={onClose}><section className="recommend-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" onClick={onClose} aria-label="閉じる">×</button><span className="idea-tag">{suggestion.genre}</span><p className="idea-eyebrow">{suggestion.eyebrow}</p><h2>{suggestion.title}</h2><p className="modal-summary">{suggestion.summary}</p>
    <div className="modal-block"><h3>なぜ今、この企画？</h3><p>{suggestion.whyNow}</p></div><div className="modal-block"><h3>おすすめ構成案・具体例</h3><ol>{suggestion.contentOutline.map((item) => <li key={item}>{item}</li>)}</ol></div>
    <p className="modal-source">着想に使った過去配信　<strong>{suggestion.sourceTitle}</strong></p><button className="recommend-primary" onClick={onCopy}>企画メモをコピー <Icon name="check" size={18}/></button>
  </section></div>;
}

function Recommend() {
  const [dashboard, setDashboard] = useState<RecommendationDashboard>(fallbackDashboard);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(1);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ExistingSuggestion | null>(null);
  const [pitchOpen, setPitchOpen] = useState(false);
  const [toast, setToast] = useState('');

  const loadDashboard = async (companyId?: string) => {
    setLoading(true);
    try {
      const suffix = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
      const response = await fetch(`${apiBaseUrl}/recommendations${suffix}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setDashboard((await response.json()) as RecommendationDashboard);
      setVisibleCount(1);
      setCompanyOpen(false);
      if (companyId) setToast('分析対象の企業を切り替えました');
    } catch { setToast('提案APIに接続できないため、デモ内容を表示しています'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadDashboard(new URLSearchParams(window.location.search).get('companyId') ?? undefined); }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!companyOpen || companies.length) return;
    fetch(`${apiBaseUrl}/recommendation-companies`).then(async (response) => {
      if (!response.ok) throw new Error(); return (await response.json()) as { items: CompanySummary[] };
    }).then((data) => setCompanies(data.items)).catch(() => setToast('企業一覧を取得できませんでした'));
  }, [companyOpen, companies.length]);

  const filteredCompanies = useMemo(() => companies.filter((item) => `${item.name} ${item.industry}`.toLowerCase().includes(query.toLowerCase())).slice(0, 80), [companies, query]);
  const opportunity = dashboard.newOpportunity;
  const copySuggestion = async (suggestion: ExistingSuggestion) => {
    await copyText([suggestion.title, '', suggestion.summary, '', ...suggestion.contentOutline.map((item, i) => `${i + 1}. ${item}`), '', `着想元：${suggestion.sourceTitle}`].join('\n'));
    setSelected(null); setToast('企画メモをコピーしました');
  };
  const copyPitch = async () => {
    await copyText([opportunity.title, '', opportunity.pitch, '', ...opportunity.contentOutline.map((item, i) => `${i + 1}. ${item}`)].join('\n'));
    setPitchOpen(false); setToast('提案文をコピーしました');
  };

  return <><div className="breadcrumb">分析データ　<span>›</span>　レコメンド</div><div className="content recommend-page">
    <div className="recommend-hero"><div><p className="recommend-kicker"><Icon name="sparkles" size={16}/> AI PRESS RELEASE RECOMMEND</p><h1>次の発信テーマを<br/>見つける</h1><p>過去の配信実績と企業情報を分析し、いま発信すべき企画を提案します。</p></div>
      <button className="company-switch" onClick={() => setCompanyOpen(true)}><span>{dashboard.company.initials}</span><div><small>分析中の企業</small><strong>{dashboard.company.name}</strong></div><Icon name="arrow" size={18}/></button>
    </div>
    <div className="recommend-stats"><div><strong>{dashboard.stats.releasesAnalyzed}</strong><span>過去配信を分析</span></div><div><strong>{dashboard.stats.genresFound}</strong><span>発信ジャンル</span></div><div><strong>{dashboard.stats.lastPublished}</strong><span>最終配信</span></div><span className={`engine-state engine-state--${dashboard.meta.mode}`}>{loading ? '分析中…' : dashboard.meta.mode === 'openai' ? 'OpenAI 生成済み' : 'デモモード'}</span></div>
    <section className="recommend-grid"><div className="past-ideas"><div className="recommend-section-title"><div><p>01　BUILD ON YOUR STORY</p><h2>これまでの発信を、<br/>次の記事へつなげる</h2></div>{dashboard.meta.recommendedFocus === 'existing' && <span>いまのおすすめ</span>}</div>
      <div className="idea-list">{dashboard.existingSuggestions.slice(0, visibleCount).map((suggestion) => <article className="idea-card" key={suggestion.id}><p className="idea-eyebrow">{suggestion.eyebrow}</p><span className="idea-tag">{suggestion.genre}</span><h3>{suggestion.title}</h3><p>{suggestion.summary}</p><div className="idea-source"><Icon name="file" size={16}/><span>着想元</span><strong>{suggestion.sourceTitle}</strong></div><button onClick={() => setSelected(suggestion)}>企画の詳細を見る <Icon name="arrow" size={17}/></button></article>)}</div>
      {dashboard.existingSuggestions.length > 1 && <button className="show-more" onClick={() => setVisibleCount(visibleCount === 1 ? dashboard.existingSuggestions.length : 1)}>{visibleCount === 1 ? `ほかの提案も見る（${dashboard.existingSuggestions.length - 1}件）` : '表示を閉じる'}</button>}
    </div><aside className="new-idea"><div className="new-idea-top"><p>02　FIND A NEW STORY</p><span><Icon name="sparkles" size={14}/>{dashboard.meta.recommendedFocus === 'new' ? 'いまのおすすめ' : 'NEW'}</span></div><h2>まだ語っていない、<br/>あなたの会社の魅力</h2><p>過去の発信にはなかった、新しい切り口を見つけました。</p><div className="opportunity"><span><Icon name="lightbulb" size={17}/> 未発信ジャンル　<strong>{opportunity.genre}</strong></span><p>{opportunity.eyebrow}</p><h3>{opportunity.title}</h3><p>{opportunity.summary}</p></div><div className="idea-reason"><Icon name="sparkles" size={18}/><div><strong>なぜ、これが魅力になる？</strong><p>{opportunity.opportunityReason}</p></div></div><button onClick={() => setPitchOpen(true)}>この提案文を使う <Icon name="arrow" size={18}/></button></aside></section>
    <p className="recommend-note"><Icon name="sparkles" size={14}/> 提案は過去の配信・企業情報をもとにAIが作成しています。公開前に事実確認を行ってください。</p>
  </div>
  {companyOpen && <div className="recommend-overlay" onMouseDown={() => setCompanyOpen(false)}><aside className="company-panel" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setCompanyOpen(false)}>×</button><p className="idea-eyebrow">COMPANY PROFILE</p><h2>分析対象の企業を選択</h2><div className="company-search"><Icon name="search" size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="企業名・業種で検索"/></div><div className="company-list">{filteredCompanies.map((item) => <button key={item.id} disabled={item.id === dashboard.company.id} onClick={() => void loadDashboard(item.id)}><span>{item.initials}</span><div><strong>{item.name}</strong><small>{item.industry}・配信{item.releaseCount}件</small></div>{item.id === dashboard.company.id ? <Icon name="check" size={18}/> : <Icon name="arrow" size={18}/>}</button>)}</div><div className="company-profile"><p><Icon name="building" size={17}/>{dashboard.company.industry}</p><p><Icon name="map" size={17}/>{dashboard.company.location}</p><p><Icon name="calendar" size={17}/>{dashboard.company.founded}</p></div></aside></div>}
  {selected && <DetailModal suggestion={selected} onClose={() => setSelected(null)} onCopy={() => void copySuggestion(selected)}/>}
  {pitchOpen && <div className="recommend-overlay" onMouseDown={() => setPitchOpen(false)}><section className="recommend-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setPitchOpen(false)}>×</button><span className="idea-tag">{opportunity.genre}</span><p className="idea-eyebrow">PRESS RELEASE IDEA</p><h2>{opportunity.title}</h2><div className="pitch-copy">{opportunity.pitch}</div><div className="modal-block"><h3>おすすめ構成案・具体例</h3><ol>{opportunity.contentOutline.map((item) => <li key={item}>{item}</li>)}</ol></div><button className="recommend-primary" onClick={() => void copyPitch()}>提案文をコピー <Icon name="check" size={18}/></button></section></div>}
  {toast && <div className="recommend-toast" role="status"><Icon name="check" size={17}/>{toast}</div>}</>;
}

export function App() {
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [page, setPage] = useState<'dashboard' | 'recommend'>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const changePage = (next: 'dashboard' | 'recommend') => { setPage(next); setMobileOpen(false); };
  return <div className="app-shell"><Header toggleMenu={() => setMobileOpen(!mobileOpen)}/>{mobileOpen && <button className="scrim" aria-label="メニューを閉じる" onClick={() => setMobileOpen(false)}/>}<Sidebar analysisOpen={analysisOpen} setAnalysisOpen={setAnalysisOpen} page={page} setPage={changePage} mobileOpen={mobileOpen}/><main className="main-area"><button className="sidebar-collapse" aria-label="サイドバー"><Icon name="menu" size={25}/></button>{page === 'dashboard' ? <Dashboard/> : <Recommend/>}</main></div>;
}
