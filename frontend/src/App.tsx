import { useState, type ReactNode } from 'react';

type IconName =
  | 'apps'
  | 'document'
  | 'media'
  | 'book'
  | 'chart'
  | 'clip'
  | 'company'
  | 'menu'
  | 'bell'
  | 'user'
  | 'phone'
  | 'form'
  | 'sparkles';

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
};

function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

const notices = [
  {
    title: 'コンテンツ掲載基準を更新しました',
    body: '「日本初」「No.1」等の最上級表現の改定や、メディアタイアップ広告に関する基準の新設など、コンテンツ掲載基準を更新しました。ご配信前に、ぜひ',
    link: '改定・新設のご案内',
    tail: 'をご確認いただけますと幸いです。',
  },
  {
    title: 'WebクリッピングでSNS投稿の取得が可能になりました',
    body: 'Webクリッピングのクリップ調査で、指定したキーワードに基づきSNS（X、Instagram、TikTok）上の投稿を毎日自動で取得し、一覧で確認できるようになりました。Web記事だけでなく、SNS上の生活者の反響もまとめてご確認いただけます。',
    note: '※2026年10月14日までは、現在のクリップ調査の料金（1クリップ月額5,000円）でご利用いただけます。',
    link: 'SNS投稿取得機能の詳細を見る',
  },
];

function Sidebar({ analysisOpen, setAnalysisOpen, page, setPage, mobileOpen }: {
  analysisOpen: boolean;
  setAnalysisOpen: (open: boolean) => void;
  page: 'dashboard' | 'recommend';
  setPage: (page: 'dashboard' | 'recommend') => void;
  mobileOpen: boolean;
}) {
  const menuItems: Array<{ label: string; icon: IconName }> = [
    { label: 'プレスリリース', icon: 'document' },
    { label: 'メディアリスト', icon: 'media' },
    { label: 'ストーリー', icon: 'book' },
  ];

  useEffect(() => {
    if (!companyOpen || companies.length > 0) return;
    const controller = new AbortController();
    setCompaniesLoading(true);
    fetch(`${apiBaseUrl}/recommendation-companies`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as { items: CompanySummary[] };
      })
      .then((data) => setCompanies(data.items))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setToast('企業一覧を取得できませんでした');
      })
      .finally(() => setCompaniesLoading(false));
    return () => controller.abort();
  }, [companyOpen, companies.length]);

  useEffect(() => {
    if (!companyOpen && !selectedSuggestion && !pitchOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCompanyOpen(false);
        setSelectedSuggestion(null);
        setPitchOpen(false);
      }
    };
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', close);
    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', close);
    };
  }, [companyOpen, selectedSuggestion, pitchOpen]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const copyPitch = async () => {
    const copyText = [
      dashboard.newOpportunity.title,
      '',
      dashboard.newOpportunity.pitch,
      '',
      'おすすめ構成案・具体例',
      ...dashboard.newOpportunity.contentOutline.map((item, index) => `${index + 1}. ${item}`),
    ].join('\n');
    try {
      const copied = await writeToClipboard(copyText);
      if (!copied) throw new Error('Clipboard is unavailable');
      setPitchOpen(false);
      setToast('提案文をコピーしました');
    } catch {
      setToast('コピーできませんでした');
    }
  };

  const useSuggestion = async (suggestion: ExistingSuggestion) => {
    const copyText = [
      suggestion.title,
      '',
      suggestion.summary,
      '',
      'おすすめ構成案・具体例',
      ...suggestion.contentOutline.map((item, index) => `${index + 1}. ${item}`),
      '',
      `着想元：${suggestion.sourceTitle}`,
    ].join('\n');
    try {
      const copied = await writeToClipboard(copyText);
      if (!copied) throw new Error('Clipboard is unavailable');
      setSelectedSuggestion(null);
      setToast('企画メモをコピーしました');
    } catch {
      setToast('コピーできませんでした');
    }
  };

  const selectCompany = async (companyId: string) => {
    if (companyId === dashboard.company.id || changingCompanyId) return;
    setChangingCompanyId(companyId);
    setLoading(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/recommendations?companyId=${encodeURIComponent(companyId)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as RecommendationDashboard;
      setDashboard(data);
      setVisibleCount(1);
      setSelectedSuggestion(null);
      setPitchOpen(false);
      setCompanyOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.set('companyId', companyId);
      window.history.replaceState({}, '', url);
      setToast(`${data.company.name}に切り替えました`);
    } catch {
      setToast('企業の切り替えに失敗しました');
    } finally {
      setChangingCompanyId(null);
      setLoading(false);
    }
  };

  const opportunity = dashboard.newOpportunity;

  return (
    <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
      <nav aria-label="メインメニュー">
        <button className={`nav-item nav-item--dashboard ${page === 'dashboard' ? 'is-active' : ''}`} onClick={() => setPage('dashboard')}>
          <Icon name="apps" /><span>ダッシュボード</span>
        </button>
        {menuItems.map((item) => (
          <button className="nav-item" key={item.label}>
            <Icon name={item.icon} /><span>{item.label}</span><span className="nav-arrow">›</span>
          </button>
        ))}
        <button className={`nav-item ${analysisOpen ? 'is-expanded' : ''}`} aria-expanded={analysisOpen} onClick={() => setAnalysisOpen(!analysisOpen)}>
          <Icon name="chart" /><span>分析データ</span><span className="nav-arrow nav-arrow--chevron">⌄</span>
        </button>
        {analysisOpen && (
          <div className="subnav">
            <button>レポート</button>
            <button>提携オンラインメディア</button>
            <button>ソーシャル</button>
            <button>広告換算ツール</button>
            <button className={page === 'recommend' ? 'is-current' : ''} onClick={() => setPage('recommend')}>
              <Icon name="sparkles" size={19} />レコメンド<span className="new-badge">NEW</span>
            </button>
          </div>
        )}
        <button className="nav-item"><Icon name="clip" /><span>Webクリッピング</span><span className="nav-arrow">›</span></button>
        <button className="nav-item"><Icon name="company" /><span>企業ページ</span><span className="nav-arrow">›</span></button>
      </nav>
    </aside>
  );
}

function Header({ toggleMenu }: { toggleMenu: () => void }) {
  return (
    <header className="header">
      <div className="brand" aria-label="PR TIMES">PR<span>ΤΙΜΕS</span></div>
      <button className="mobile-menu" onClick={toggleMenu} aria-label="メニューを開く"><Icon name="menu" /></button>
      <div className="header-actions">
        <button className="create-button">メディアリスト新規作成</button>
        <button className="create-button create-button--primary">プレスリリース新規作成</button>
      </div>
      <div className="support">
        <span className="support-label">サポートデスクはこちら</span>
        <div className="support-row"><Icon name="phone" size={25} /><strong>03-6625-4684</strong></div>
      </div>
      <button className="contact-button"><Icon name="form" size={23} />問い合わせフォーム</button>
      <button className="icon-button" aria-label="通知"><Icon name="bell" size={26} /></button>
      <div className="account"><div>株式会社ハッカソン</div><small>企業ID：99125</small></div>
      <button className="account-icon" aria-label="アカウント"><Icon name="user" size={44} /></button>
    </header>
  );
}

function Dashboard() {
  const [openNotices, setOpenNotices] = useState([true, true]);
  const [projectVisible, setProjectVisible] = useState(true);
  const [projectOpen, setProjectOpen] = useState(false);

  const toggleNotice = (index: number) => {
    setOpenNotices((current) => current.map((open, i) => i === index ? !open : open));
  };

  return (
    <>
      <div className="breadcrumb">ダッシュボード</div>
      <div className="content">
        <h1>ダッシュボード</h1>
        {projectVisible && (
          <section className="project-bar">
            <button className="project-toggle" onClick={() => setProjectOpen(!projectOpen)} aria-expanded={projectOpen}>
              <strong>テスト4</strong><span>{projectOpen ? '⌃' : '⌄'}</span>
            </button>
            <button className="close-button" onClick={() => setProjectVisible(false)} aria-label="閉じる">×</button>
            {projectOpen && <p className="project-detail">現在選択中のプロジェクトです</p>}
          </section>
        )}
        <div className="notice-list">
          {notices.map((notice, index) => (
            <article className="notice-card" key={notice.title}>
              <div className="notice-heading">
                <button onClick={() => toggleNotice(index)} aria-expanded={openNotices[index]}>
                  <h2>{notice.title}</h2><span>{openNotices[index] ? '⌃' : '⌄'}</span>
                </button>
                <button className="close-button" aria-label="閉じる">×</button>
              </div>
              {openNotices[index] && (
                <div className="notice-body">
                  <p>{notice.body}{index === 0 && <><a href="#guide">{notice.link}</a>{notice.tail}</>}</p>
                  {notice.note && <p>{notice.note}</p>}
                  {index === 1 && <a id="guide" href="#details">{notice.link}</a>}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

function Recommend() {
  return (
    <>
      <div className="breadcrumb">分析データ　<span>›</span>　レコメンド</div>
      <div className="content recommend-page">
        <div className="recommend-title"><span><Icon name="sparkles" size={27} /></span><div><p>分析データ</p><h1>レコメンド</h1></div></div>
        <section className="recommend-placeholder">
          <div className="placeholder-icon"><Icon name="sparkles" size={36} /></div>
          <h2>レコメンド機能</h2>
          <p>蓄積した分析データをもとに、次のアクションにつながるおすすめを表示するエリアです。</p>
          <span className="coming-soon">COMING SOON</span>
        </section>
      </div>
    </>
  );
}

export function App() {
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [page, setPage] = useState<'dashboard' | 'recommend'>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);

  const changePage = (nextPage: 'dashboard' | 'recommend') => {
    setPage(nextPage);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell">
      <Header toggleMenu={() => setMobileOpen(!mobileOpen)} />
      {mobileOpen && <button className="scrim" aria-label="メニューを閉じる" onClick={() => setMobileOpen(false)} />}
      <Sidebar analysisOpen={analysisOpen} setAnalysisOpen={setAnalysisOpen} page={page} setPage={changePage} mobileOpen={mobileOpen} />
      <main className="main-area">
        <button className="sidebar-collapse" aria-label="サイドバー"><Icon name="menu" size={25} /></button>
        {page === 'dashboard' ? <Dashboard /> : <Recommend />}
      </main>
    </div>
  );
}
