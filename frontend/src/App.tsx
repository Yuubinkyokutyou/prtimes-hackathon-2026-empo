import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  fallbackDashboard,
  type CompanySummary,
  type ExistingSuggestion,
  type NewOpportunity,
  type RecommendationDashboard,
} from './data';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

type IconName =
  | 'arrow'
  | 'building'
  | 'calendar'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'file'
  | 'globe'
  | 'lightbulb'
  | 'map'
  | 'sparkles'
  | 'users'
  | 'x';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    building: <><path d="M4 21h16" /><path d="M6 21V7l6-3v17" /><path d="M12 9h6v12" /><path d="M9 9v.01M9 13v.01M9 17v.01M15 13v.01M15 17v.01" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    lightbulb: <><path d="M9 18h6M10 22h4" /><path d="M8.3 15.2A7 7 0 1 1 15.7 15.2c-.9.7-1.4 1.5-1.5 2.3h-4.4c-.1-.8-.6-1.6-1.5-2.3Z" /></>,
    map: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    sparkles: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7ZM5 13l.7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7Z" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
    x: <><path d="M18 6 6 18M6 6l12 12" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}

function Brand() {
  return (
    <div className="brand" aria-label="KIKKAKE ホーム">
      <span className="brand__mark"><span /></span>
      <span className="brand__text">
        <strong>KIKKAKE</strong>
        <small>次の発信を見つける</small>
      </span>
    </div>
  );
}

async function writeToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue to the compatibility fallback below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

function SuggestionCard({
  suggestion,
  onOpen,
}: {
  suggestion: ExistingSuggestion;
  onOpen: () => void;
}) {
  return (
    <article className="suggestion-card">
      <div className="suggestion-card__content">
        <div className="suggestion-card__topline">
          <div>
            <p className="micro-label">{suggestion.eyebrow}</p>
            <span className="genre-tag">{suggestion.genre}</span>
          </div>
        </div>

        <h3>{suggestion.title}</h3>
        <p className="suggestion-card__summary">{suggestion.summary}</p>
        <div className="suggestion-card__source">
          <Icon name="file" size={15} />
          <span>着想元</span>
          <strong>{suggestion.sourceTitle}</strong>
        </div>
        <button className="text-button" onClick={onOpen} type="button">
          企画の詳細を見る <Icon name="arrow" size={17} />
        </button>
      </div>
    </article>
  );
}

function CompanyPanel({
  data,
  companies,
  companiesLoading,
  changingCompanyId,
  onClose,
  onSelectCompany,
}: {
  data: RecommendationDashboard;
  companies: CompanySummary[];
  companiesLoading: boolean;
  changingCompanyId: string | null;
  onClose: () => void;
  onSelectCompany: (companyId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filteredCompanies = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP');
    const matches = normalizedQuery
      ? companies.filter((company) =>
          `${company.name} ${company.industry}`.toLocaleLowerCase('ja-JP').includes(normalizedQuery),
        )
      : companies;
    return matches.slice(0, 100);
  }, [companies, query]);

  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <aside
        aria-label="企業情報"
        aria-modal="true"
        className="company-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="icon-button company-panel__close" onClick={onClose} type="button" aria-label="閉じる">
          <Icon name="x" />
        </button>
        <p className="micro-label">COMPANY PROFILE</p>
        <div className="company-panel__identity">
          <span className="company-avatar company-avatar--large">{data.company.initials}</span>
          <div><small>分析対象企業</small><h2>{data.company.name}</h2></div>
        </div>
        <section className="company-picker" aria-label="企業を選択">
          <div className="company-picker__heading">
            <label htmlFor="company-search">企業を切り替える</label>
            <small>
              {companiesLoading
                ? '読込中…'
                : `${filteredCompanies.length}件表示 / 全${companies.length}社`}
            </small>
          </div>
          <input
            autoComplete="off"
            id="company-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="企業名・業種で検索"
            type="search"
            value={query}
          />
          <div className="company-picker__list" role="list">
            {filteredCompanies.map((company) => {
              const selected = company.id === data.company.id;
              const changing = company.id === changingCompanyId;
              return (
                <button
                  aria-current={selected ? 'true' : undefined}
                  className={`company-option${selected ? ' is-selected' : ''}`}
                  disabled={Boolean(changingCompanyId) || selected}
                  key={company.id}
                  onClick={() => onSelectCompany(company.id)}
                  role="listitem"
                  type="button"
                >
                  <span className="company-avatar company-option__avatar">{company.initials}</span>
                  <span className="company-option__body">
                    <strong>{company.name}</strong>
                    <small>{company.industry}・配信{company.releaseCount}件</small>
                  </span>
                  <span className="company-option__state">
                    {changing ? '提案を生成中…' : selected ? <Icon name="check" size={16} /> : <Icon name="arrow" size={15} />}
                  </span>
                </button>
              );
            })}
            {!companiesLoading && filteredCompanies.length === 0 && (
              <p className="company-picker__empty">該当する企業がありません</p>
            )}
          </div>
        </section>
        <p className="company-panel__description">{data.company.description}</p>
        <dl className="company-details">
          <div><dt><Icon name="building" size={17} />業種</dt><dd>{data.company.industry}</dd></div>
          <div><dt><Icon name="map" size={17} />所在地</dt><dd>{data.company.location}</dd></div>
          <div><dt><Icon name="calendar" size={17} />創業</dt><dd>{data.company.founded}</dd></div>
          <div><dt><Icon name="users" size={17} />資本金</dt><dd>{data.company.capital}</dd></div>
        </dl>
        <a className="company-link" href={data.company.website} target="_blank" rel="noreferrer">
          <Icon name="globe" size={17} /> コーポレートサイト <Icon name="arrow" size={16} />
        </a>
        <div className="company-panel__note">
          <Icon name="sparkles" size={17} />
          <p>
            <strong>データについて</strong>
            <span>
              {data.meta.dataSource === 'production_subset'
                ? 'production_subsetの企業情報と過去配信を参照しています。'
                : data.meta.dataSource === 'database'
                  ? '企業情報と過去配信をデータベースから取得しています。'
                  : 'データベースに接続できないため、seed準拠のデモデータを表示しています。'}
            </span>
          </p>
        </div>
      </aside>
    </div>
  );
}

function SuggestionModal({
  suggestion,
  onClose,
  onUse,
}: {
  suggestion: ExistingSuggestion;
  onClose: () => void;
  onUse: () => void;
}) {
  return (
    <div className="overlay overlay--center" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="detail-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="icon-button detail-modal__close" onClick={onClose} type="button" aria-label="閉じる">
          <Icon name="x" />
        </button>
        <div className="detail-modal__heading">
          <span className="genre-tag">{suggestion.genre}</span>
        </div>
        <p className="micro-label">{suggestion.eyebrow}</p>
        <h2>{suggestion.title}</h2>
        <p className="detail-modal__summary">{suggestion.summary}</p>

        <div className="detail-grid">
          <div className="detail-block detail-block--accent">
            <span className="detail-block__icon"><Icon name="clock" size={18} /></span>
            <div><h3>なぜ今、この企画？</h3><p>{suggestion.whyNow}</p></div>
          </div>
          <div className="detail-block">
            <span className="detail-block__icon"><Icon name="file" size={18} /></span>
            <div><h3>おすすめ構成案・具体例</h3><ol>{suggestion.contentOutline.map((item) => <li key={item}>{item}</li>)}</ol></div>
          </div>
        </div>
        <div className="detail-modal__source"><span>着想に使った過去配信</span><strong>{suggestion.sourceTitle}</strong></div>
        <button className="primary-button primary-button--wide" onClick={onUse} type="button">
          この企画を記事にする <Icon name="arrow" />
        </button>
      </section>
    </div>
  );
}

function PitchModal({
  opportunity,
  onClose,
  onCopy,
}: {
  opportunity: NewOpportunity;
  onClose: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="overlay overlay--center" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="提案文"
        aria-modal="true"
        className="detail-modal pitch-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="icon-button detail-modal__close" onClick={onClose} type="button" aria-label="閉じる">
          <Icon name="x" />
        </button>
        <span className="genre-tag">{opportunity.genre}</span>
        <p className="micro-label pitch-modal__label">PRESS RELEASE IDEA</p>
        <h2>{opportunity.title}</h2>

        <div className="pitch-modal__copy">
          <p>{opportunity.pitch}</p>
        </div>

        <div className="detail-grid">
          <div className="detail-block">
            <span className="detail-block__icon"><Icon name="file" size={18} /></span>
            <div>
              <h3>おすすめ構成案・具体例</h3>
              <ol>{opportunity.contentOutline.map((item) => <li key={item}>{item}</li>)}</ol>
            </div>
          </div>
        </div>

        <button className="primary-button primary-button--wide" onClick={onCopy} type="button">
          提案文をコピーする <Icon name="check" />
        </button>
      </section>
    </div>
  );
}

export function App() {
  const [dashboard, setDashboard] = useState<RecommendationDashboard>(fallbackDashboard);
  const [visibleCount, setVisibleCount] = useState(1);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<ExistingSuggestion | null>(null);
  const [pitchOpen, setPitchOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [changingCompanyId, setChangingCompanyId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const requestedCompanyId = new URLSearchParams(window.location.search).get('companyId');
    const query = requestedCompanyId ? `?companyId=${encodeURIComponent(requestedCompanyId)}` : '';
    fetch(`${apiBaseUrl}/recommendations${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as RecommendationDashboard;
      })
      .then((data) => {
        setDashboard(data);
        setVisibleCount(1);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setToast('提案APIに接続できないため、デモ内容を表示しています');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

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
    <div className="app-shell">
      <header className="site-header">
        <Brand />
        <button className="company-trigger" onClick={() => setCompanyOpen(true)} type="button">
          <span className="company-avatar">{dashboard.company.initials}</span>
          <span className="company-trigger__text"><small>分析中の企業</small><strong>{dashboard.company.name}</strong></span>
          <Icon name="chevron" size={16} />
        </button>
      </header>

      <main>
        <section className={`recommendation-grid recommendation-grid--focus-${dashboard.meta.recommendedFocus}`}>
          <div className="past-panel">
            <div className="section-heading">
              <div>
                <p className="section-kicker"><span>01</span> BUILD ON YOUR STORY</p>
                <h2>これまでの発信を、<br />次の記事へつなげる</h2>
              </div>
              {dashboard.meta.recommendedFocus === 'existing' && <span className="focus-badge">いまのおすすめ</span>}
            </div>

            <div className="suggestion-list">
              {dashboard.existingSuggestions.slice(0, visibleCount).map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  onOpen={() => setSelectedSuggestion(suggestion)}
                />
              ))}
            </div>

            <button
              className="more-button"
              onClick={() => setVisibleCount(visibleCount === 1 ? dashboard.existingSuggestions.length : 1)}
              type="button"
            >
              <span>{visibleCount === 1 ? `ほかの提案も見る（${dashboard.existingSuggestions.length - 1}件）` : '表示を閉じる'}</span>
              <span className={visibleCount === 1 ? '' : 'is-rotated'}><Icon name="chevron" /></span>
            </button>
          </div>

          <aside className="discovery-panel">
            <div className="discovery-panel__glow" aria-hidden="true" />
            <div className="discovery-panel__top">
              <p className="section-kicker section-kicker--light"><span>02</span> FIND A NEW STORY</p>
              <span className="new-badge"><Icon name="sparkles" size={13} /> {dashboard.meta.recommendedFocus === 'new' ? 'いまのおすすめ' : 'NEW PERSPECTIVE'}</span>
            </div>
            <h2>まだ語っていない、<br />あなたの会社の魅力</h2>
            <p className="discovery-panel__intro">過去の発信にはなかった、新しい切り口を見つけました。</p>

            <div className="opportunity-card">
              <div className="opportunity-card__genre"><Icon name="lightbulb" size={17} /><span>未発信ジャンル</span><strong>{opportunity.genre}</strong></div>
              <p className="micro-label micro-label--light">{opportunity.eyebrow}</p>
              <h3>{opportunity.title}</h3>
              <p>{opportunity.summary}</p>
            </div>

            <div className="reason-box">
              <span className="reason-box__icon"><Icon name="sparkles" size={17} /></span>
              <div><strong>なぜ、これが魅力になる？</strong><p>{opportunity.opportunityReason}</p></div>
            </div>

            <button className="light-button" onClick={() => setPitchOpen(true)} type="button">
              この提案文を使う <Icon name="arrow" />
            </button>
          </aside>
        </section>

        <footer className="site-footer">
          <Brand />
          <p><Icon name="sparkles" size={14} /> 提案は過去の配信・企業情報をもとにAIが作成しています。公開前に事実確認を行ってください。</p>
          <span className={`engine-badge engine-badge--${dashboard.meta.mode}`}>
            <i />
            {loading ? '提案を準備中…' : dashboard.meta.mode === 'openai' ? 'OpenAI 生成済み' : 'デモモード'}
          </span>
        </footer>
      </main>

      {companyOpen && (
        <CompanyPanel
          companies={companies}
          companiesLoading={companiesLoading}
          changingCompanyId={changingCompanyId}
          data={dashboard}
          onClose={() => setCompanyOpen(false)}
          onSelectCompany={selectCompany}
        />
      )}
      {selectedSuggestion && (
        <SuggestionModal
          suggestion={selectedSuggestion}
          onClose={() => setSelectedSuggestion(null)}
          onUse={() => useSuggestion(selectedSuggestion)}
        />
      )}
      {pitchOpen && (
        <PitchModal
          opportunity={opportunity}
          onClose={() => setPitchOpen(false)}
          onCopy={copyPitch}
        />
      )}
      {toast && <div className="toast" role="status"><Icon name="check" size={17} />{toast}</div>}
    </div>
  );
}
