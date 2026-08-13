import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  type CompanySummary,
  type ExistingSuggestion,
  type NewOpportunity,
  type RecommendationCompanyProfile,
  type RecommendationDashboard,
  type RecommendationGenerationOptions,
  type RecommendationHistoryItem,
  type RegeneratedRecommendationItem,
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(date)
    : '不明';
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./u, '');
  } catch {
    return '配信元サイト';
  }
}

function SuggestionCard({
  suggestion,
  busy,
  onOpen,
  onRegenerate,
}: {
  suggestion: ExistingSuggestion;
  busy: boolean;
  onOpen: () => void;
  onRegenerate: () => void;
}) {
  return (
    <article className="suggestion-card">
      <div className="suggestion-card__content">
        <div className="suggestion-card__topline">
          <div>
            <p className="micro-label">{suggestion.eyebrow}</p>
            <span className="genre-tag">{suggestion.genre}</span>
          </div>
          <button className="card-regenerate" disabled={busy} onClick={onRegenerate} type="button">
            <Icon name="sparkles" size={15} /> {busy ? '作成中…' : 'この案だけ作り直す'}
          </button>
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
  onClose,
}: {
  data: RecommendationCompanyProfile;
  onClose: () => void;
}) {
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
        <p className="company-panel__description">{data.company.description}</p>
        <dl className="company-details">
          <div><dt><Icon name="building" size={17} />業種</dt><dd>{data.company.industry}</dd></div>
          <div><dt><Icon name="map" size={17} />所在地</dt><dd>{data.company.location}</dd></div>
          <div><dt><Icon name="calendar" size={17} />創業</dt><dd>{data.company.founded}</dd></div>
          <div><dt><Icon name="users" size={17} />資本金</dt><dd>{data.company.capital}</dd></div>
          <div><dt><Icon name="file" size={17} />過去の配信</dt><dd>{data.stats.releaseCount}件</dd></div>
          <div><dt><Icon name="clock" size={17} />最終配信日</dt><dd>{data.stats.lastPublishedAt ? new Date(data.stats.lastPublishedAt).toLocaleDateString('ja-JP') : '—'}</dd></div>
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
                : '企業情報と過去配信をデータベースから取得しています。'}
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
  onUse: (suggestion: ExistingSuggestion) => void;
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
        <div className="detail-modal__source">
          <span>着想に使った過去配信</span>
          {suggestion.sourceUrl ? (
            <a className="source-preview" href={suggestion.sourceUrl} target="_blank" rel="noreferrer">
              {suggestion.sourceImageUrl && (
                <img
                  alt=""
                  src={suggestion.sourceImageUrl}
                  onError={(event) => { event.currentTarget.hidden = true; }}
                />
              )}
              <span className="source-preview__body">
                <small>{sourceHost(suggestion.sourceUrl)}</small>
                <strong>{suggestion.sourceTitle}</strong>
                <em>元の配信を見る <Icon name="arrow" size={14} /></em>
              </span>
            </a>
          ) : <strong>{suggestion.sourceTitle}</strong>}
        </div>
        <button className="primary-button primary-button--wide" onClick={() => onUse(suggestion)} type="button">
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
  onCopy: (opportunity: NewOpportunity) => void;
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
        <div className="detail-modal__heading">
          <span className="genre-tag">{opportunity.genre}</span>
        </div>
        <p className="micro-label pitch-modal__label">PRESS RELEASE IDEA</p>
        <h2>{opportunity.title}</h2>

        <div className="pitch-modal__copy">
          <p>{opportunity.pitch}</p>
        </div>

        <div className="detail-grid">
          <div className="detail-block detail-block--accent">
            <span className="detail-block__icon"><Icon name="sparkles" size={18} /></span>
            <div>
              <h3>なぜ、これが魅力になる？</h3>
              <p>{opportunity.opportunityReason}</p>
            </div>
          </div>
          <div className="detail-block">
            <span className="detail-block__icon"><Icon name="file" size={18} /></span>
            <div>
              <h3>おすすめ構成案・具体例</h3>
              <ol>{opportunity.contentOutline.map((item) => <li key={item}>{item}</li>)}</ol>
            </div>
          </div>
        </div>

        <button className="primary-button primary-button--wide" onClick={() => onCopy(opportunity)} type="button">
          提案文をコピーする <Icon name="check" />
        </button>
      </section>
    </div>
  );
}

function GenerationModal({
  initial,
  busy,
  onClose,
  onGenerate,
}: {
  initial: RecommendationGenerationOptions;
  busy: boolean;
  onClose: () => void;
  onGenerate: (options: RecommendationGenerationOptions) => void;
}) {
  const [options, setOptions] = useState(initial);
  return (
    <div className="overlay overlay--center" role="presentation" onMouseDown={onClose}>
      <form className="detail-modal condition-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onGenerate(options); }}>
        <button className="icon-button detail-modal__close" onClick={onClose} type="button" aria-label="閉じる"><Icon name="x" /></button>
        <p className="micro-label">GENERATION CONDITIONS</p>
        <h2>条件を指定して再生成</h2>
        <div className="editor-form editor-form--grid">
          <label>優先する企画
            <select value={options.focus} onChange={(event) => setOptions({ ...options, focus: event.target.value as RecommendationGenerationOptions['focus'] })}>
              <option value="auto">配信状況から自動判定</option><option value="existing">過去記事の活用</option><option value="new">新しい切り口</option>
            </select>
          </label>
          <label>文体
            <select value={options.tone} onChange={(event) => setOptions({ ...options, tone: event.target.value as RecommendationGenerationOptions['tone'] })}>
              <option value="standard">標準</option><option value="formal">フォーマル</option><option value="friendly">親しみやすい</option><option value="bold">印象的・大胆</option>
            </select>
          </label>
          <label>想定読者<input maxLength={200} placeholder="例：地域の中小企業経営者" value={options.audience} onChange={(event) => setOptions({ ...options, audience: event.target.value })} /></label>
          <label>発信目的<input maxLength={300} placeholder="例：採用候補者に企業文化を伝える" value={options.objective} onChange={(event) => setOptions({ ...options, objective: event.target.value })} /></label>
          <label className="editor-form__wide">追加情報<textarea maxLength={2000} rows={5} placeholder="今回必ず含めたい事実や避けたい表現" value={options.additionalContext} onChange={(event) => setOptions({ ...options, additionalContext: event.target.value })} /></label>
        </div>
        <button className="primary-button primary-button--wide" disabled={busy} type="submit">{busy ? '再生成しています…' : 'この条件で再生成'} <Icon name="sparkles" /></button>
      </form>
    </div>
  );
}

function HistoryPanel({
  items,
  loading,
  onClose,
  onLoad,
}: {
  items: RecommendationHistoryItem[];
  loading: boolean;
  onClose: () => void;
  onLoad: (id: string) => void;
}) {
  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <aside className="company-panel history-panel" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="生成履歴">
        <button className="icon-button company-panel__close" onClick={onClose} type="button" aria-label="閉じる"><Icon name="x" /></button>
        <p className="micro-label">GENERATION HISTORY</p><h2>生成履歴</h2>
        <p className="history-panel__intro">生成結果はPostgreSQLに保存され、いつでも履歴から開けます。</p>
        <div className="history-list">
          {items.map((item) => (
            <button key={item.id} onClick={() => onLoad(item.id)} type="button">
              <span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString('ja-JP')}・{item.mode === 'openai' ? 'OpenAI' : 'テンプレート'}</small></span>
              <span className={`history-state${item.saved ? ' is-saved' : ''}`}>{item.saved ? '保存済み' : '自動保存'}</span>
            </button>
          ))}
          {!loading && items.length === 0 && <p className="company-picker__empty">履歴はまだありません</p>}
          {loading && <p className="company-picker__empty">履歴を読み込んでいます…</p>}
        </div>
      </aside>
    </div>
  );
}

type RecommendationLayer = 'existing' | 'new';

function layerFromLastPublished(dashboard: RecommendationDashboard): RecommendationLayer {
  const days = dashboard.meta.daysSinceLastPublished;
  return days !== null && days >= 60 ? 'existing' : 'new';
}

function RecommendationApp({
  companyId,
  initialLayer,
}: {
  companyId?: string;
  initialLayer?: RecommendationLayer;
}) {
  const [dashboard, setDashboard] = useState<RecommendationDashboard | null>(null);
  const [visibleCount, setVisibleCount] = useState(1);
  const [visibleOpportunityCount, setVisibleOpportunityCount] = useState(1);
  const [selectedSuggestion, setSelectedSuggestion] = useState<ExistingSuggestion | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<NewOpportunity | null>(null);
  const [selectedSourceReleaseId, setSelectedSourceReleaseId] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [generationOpen, setGenerationOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RecommendationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);
  const [activeLayer, setActiveLayer] = useState<RecommendationLayer>('new');

  useEffect(() => {
    const controller = new AbortController();
    setDashboard(null);
    setLoading(true);
    setLoadError('');
    setSelectedSuggestion(null);
    setSelectedOpportunity(null);
    setHistory([]);
    const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    fetch(`${apiBaseUrl}/recommendations${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as RecommendationDashboard;
      })
      .then((data) => {
        setDashboard(data);
        setActiveLayer(initialLayer ?? layerFromLastPublished(data));
        setLoadError('');
        setVisibleCount(1);
        setVisibleOpportunityCount(1);
        setSelectedSourceReleaseId(data.sourceReleases[0]?.id ?? '');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError('企業データを取得できませんでした。APIとデータソースの状態を確認してください。');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [companyId, initialLayer]);

  useEffect(() => {
    if (!selectedSuggestion && !selectedOpportunity && !generationOpen && !historyOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedSuggestion(null);
        setSelectedOpportunity(null);
        setGenerationOpen(false);
        setHistoryOpen(false);
      }
    };
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', close);
    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', close);
    };
  }, [selectedSuggestion, selectedOpportunity, generationOpen, historyOpen]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!dashboard) {
    return (
      <div className="app-shell">
        <header className="site-header"><Brand /></header>
        <main className="status-page" role="status">
          <Icon name={loadError ? 'x' : 'sparkles'} size={24} />
          <h1>{loadError ? 'データを表示できません' : '提案を準備しています'}</h1>
          <p>{loadError || '企業情報と過去の配信をもとに提案を生成しています。通常1〜2分程度かかります。'}</p>
          {loadError && (
            <button className="primary-button" onClick={() => window.location.reload()} type="button">
              再読み込み
            </button>
          )}
        </main>
      </div>
    );
  }

  const copyPitch = async (opportunity: NewOpportunity) => {
    const copyText = [
      opportunity.title,
      '',
      opportunity.pitch,
      '',
      'おすすめ構成案・具体例',
      ...opportunity.contentOutline.map((item, index) => `${index + 1}. ${item}`),
    ].join('\n');
    try {
      const copied = await writeToClipboard(copyText);
      if (!copied) throw new Error('Clipboard is unavailable');
      setSelectedOpportunity(null);
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

  const regenerate = async (conditions?: RecommendationGenerationOptions) => {
    setActionBusy(true);
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/recommendations/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: dashboard.company.id, conditions }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as RecommendationDashboard;
      setDashboard(data);
      setActiveLayer(layerFromLastPublished(data));
      setVisibleCount(1);
      setVisibleOpportunityCount(1);
      setSelectedSourceReleaseId(data.sourceReleases[0]?.id ?? '');
      setGenerationOpen(false);
      setHistory([]);
      setToast(conditions ? '指定した条件で提案を再生成しました' : '提案を再生成しました');
    } catch {
      setToast('提案を再生成できませんでした');
    } finally {
      setActionBusy(false);
      setLoading(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/recommendations/history?companyId=${encodeURIComponent(dashboard.company.id)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { items: RecommendationHistoryItem[] };
      setHistory(data.items);
    } catch {
      setToast('生成履歴を取得できませんでした');
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadHistoryItem = async (id: string) => {
    setActionBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/recommendations/history/${id}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as RecommendationDashboard;
      setDashboard(data);
      setActiveLayer(layerFromLastPublished(data));
      setHistoryOpen(false);
      setVisibleCount(1);
      setVisibleOpportunityCount(1);
      setSelectedSourceReleaseId(data.sourceReleases[0]?.id ?? '');
      setToast('履歴の提案を開きました');
    } catch {
      setToast('履歴を開けませんでした');
    } finally {
      setActionBusy(false);
    }
  };

  const regenerateSuggestion = async (
    suggestion: ExistingSuggestion,
    sourceReleaseId = suggestion.sourceReleaseId,
  ) => {
    setItemBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/recommendations/regenerate-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: dashboard.company.id,
          layer: 'existing',
          sourceReleaseId,
          currentTitle: suggestion.title,
          conditions: dashboard.meta.conditions,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as RegeneratedRecommendationItem;
      const item = result.item as ExistingSuggestion;
      setDashboard((current) => current ? {
        ...current,
        existingSuggestions: current.existingSuggestions.map((entry) => entry.id === suggestion.id ? item : entry),
        meta: {
          ...current.meta,
          generatedAt: result.generatedAt,
          mode: result.mode,
          saved: false,
          generationNotice: result.generationNotice,
        },
      } : current);
      setSelectedSuggestion(null);
      setVisibleCount(1);
      setToast('選んだ元記事から、この案だけ作り直しました');
    } catch {
      setToast('この案を作り直せませんでした');
    } finally {
      setItemBusy(false);
    }
  };

  const regenerateOpportunity = async (opportunity: NewOpportunity) => {
    setItemBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/recommendations/regenerate-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: dashboard.company.id,
          layer: 'new',
          currentTitle: opportunity.title,
          excludedTitles: dashboard.newOpportunities
            .filter((item) => item.id !== opportunity.id)
            .map((item) => item.title),
          conditions: dashboard.meta.conditions,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as RegeneratedRecommendationItem;
      const item = result.item as NewOpportunity;
      setDashboard((current) => current ? {
        ...current,
        newOpportunities: current.newOpportunities.map((entry) => entry.id === opportunity.id ? item : entry),
        meta: {
          ...current.meta,
          generatedAt: result.generatedAt,
          mode: result.mode,
          saved: false,
          generationNotice: result.generationNotice,
        },
      } : current);
      setSelectedOpportunity(null);
      setToast('この案だけ新しい切り口で作り直しました');
    } catch {
      setToast('この案を作り直せませんでした');
    } finally {
      setItemBusy(false);
    }
  };

  const recommendedLayer = layerFromLastPublished(dashboard);

  return (
    <div className="app-shell">
      <header className="site-header"><Brand /></header>

      <main>
        <section className="dashboard-toolbar" aria-label="企画操作">
          <div className="dashboard-toolbar__actions">
            <div className="layer-switcher-stack">
              <div className="layer-switcher" role="group" aria-label="表示する企画レイヤー">
                <button
                  aria-pressed={activeLayer === 'existing'}
                  className={activeLayer === 'existing' ? 'is-active' : ''}
                  onClick={() => { setActiveLayer('existing'); setVisibleCount(1); }}
                  type="button"
                >
                  <span>01</span> 過去記事活用
                </button>
                <button
                  aria-pressed={activeLayer === 'new'}
                  className={activeLayer === 'new' ? 'is-active' : ''}
                  onClick={() => setActiveLayer('new')}
                  type="button"
                >
                  <span>02</span> 新しい切り口
                </button>
              </div>
              <span className="data-freshness" title={`提案生成：${formatDateTime(dashboard.meta.generatedAt)}`}>
                <Icon name="calendar" size={14} /> 分析データ更新 {formatDateTime(dashboard.stats.dataUpdatedAt)}
              </span>
            </div>
            <button className="secondary-button" disabled={actionBusy} onClick={() => void regenerate()} type="button"><Icon name="sparkles" size={16} /> {actionBusy ? '再生成中…' : '提案を再生成'}</button>
            <button
              aria-label="条件を指定して再生成"
              className="secondary-button toolbar-condition-button"
              disabled={actionBusy}
              onClick={() => setGenerationOpen(true)}
              type="button"
            >
              <Icon name="sparkles" size={16} />
              <span>条件を指定して再生成</span>
            </button>
            <button className="secondary-button" disabled={actionBusy} onClick={openHistory} type="button"><Icon name="clock" size={16} /> 生成履歴</button>
          </div>
        </section>
        {dashboard.meta.generationNotice && (
          <div className="generation-notice" role="status">
            <span><Icon name="sparkles" size={16} />{dashboard.meta.generationNotice}</span>
            <button onClick={() => setGenerationOpen(true)} type="button">再生成する</button>
          </div>
        )}
        <section className={`recommendation-grid recommendation-grid--single recommendation-grid--layer-${activeLayer}`}>
          {activeLayer === 'existing' && <div className="past-panel">
            <div className="section-heading">
              <div>
                <p className="section-kicker"><span>01</span> BUILD ON YOUR STORY</p>
                <h2>過去の発信を広げる</h2>
              </div>
              {recommendedLayer === 'existing' && <span className="focus-badge">いまのおすすめ</span>}
            </div>

            {dashboard.sourceReleases.length > 0 && (
              <div className="source-selector">
                <label htmlFor="source-release">元記事を選ぶ</label>
                <select
                  id="source-release"
                  onChange={(event) => setSelectedSourceReleaseId(event.target.value)}
                  value={selectedSourceReleaseId}
                >
                  {dashboard.sourceReleases.map((release) => (
                    <option key={release.id} value={release.id}>
                      {new Date(release.publishedAt).toLocaleDateString('ja-JP')}｜{release.title}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary-button"
                  disabled={itemBusy || !selectedSourceReleaseId || !dashboard.existingSuggestions[0]}
                  onClick={() => {
                    const suggestion = dashboard.existingSuggestions[0];
                    if (suggestion) void regenerateSuggestion(suggestion, selectedSourceReleaseId);
                  }}
                  type="button"
                >
                  <Icon name="sparkles" size={16} /> {itemBusy ? '作成中…' : 'この元記事から企画を作る'}
                </button>
              </div>
            )}

            <div className="suggestion-list">
              {dashboard.existingSuggestions.slice(0, visibleCount).map((suggestion) => (
                <SuggestionCard
                  busy={itemBusy}
                  key={suggestion.id}
                  suggestion={suggestion}
                  onOpen={() => setSelectedSuggestion(suggestion)}
                  onRegenerate={() => void regenerateSuggestion(suggestion)}
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
          </div>}

          {activeLayer === 'new' && <aside className="discovery-panel">
            <div className="discovery-panel__glow" aria-hidden="true" />
            <div className="discovery-panel__top">
              <p className="section-kicker section-kicker--light"><span>02</span> FIND A NEW STORY</p>
              {dashboard.newOpportunities[0] && (
                <button
                  className="card-regenerate card-regenerate--light"
                  disabled={itemBusy}
                  onClick={() => void regenerateOpportunity(dashboard.newOpportunities[0])}
                  type="button"
                >
                  <Icon name="sparkles" size={15} /> {itemBusy ? '作成中…' : 'この案だけ作り直す'}
                </button>
              )}
            </div>
            <h2>新しい切り口を見つける</h2>
            <p className="discovery-panel__intro">過去の発信にはなかった、新しい切り口を見つけました。</p>

            <div className="opportunity-list">
              {dashboard.newOpportunities.slice(0, visibleOpportunityCount).map((opportunity) => (
                <article className="opportunity-card" key={opportunity.id}>
                  <div className="opportunity-card__genre"><Icon name="lightbulb" size={17} /><span>未発信ジャンル</span><strong>{opportunity.genre}</strong></div>
                  <p className="micro-label micro-label--light">{opportunity.eyebrow}</p>
                  <h3>{opportunity.title}</h3>
                  <p>{opportunity.summary}</p>
                  <button className="opportunity-card__detail" onClick={() => setSelectedOpportunity(opportunity)} type="button">
                    企画の詳細を見る <Icon name="arrow" size={16} />
                  </button>
                </article>
              ))}
            </div>

            {dashboard.newOpportunities.length > 1 && (
              <button
                className="light-button"
                onClick={() => setVisibleOpportunityCount(visibleOpportunityCount === 1 ? dashboard.newOpportunities.length : 1)}
                type="button"
              >
                {visibleOpportunityCount === 1
                  ? `ほかの提案も見る（${dashboard.newOpportunities.length - 1}件）`
                  : '表示を閉じる'}
                <Icon name="chevron" />
              </button>
            )}
          </aside>}
        </section>

        <footer className="site-footer">
          <Brand />
          <p><Icon name="sparkles" size={14} /> 提案は過去の配信・企業情報をもとにAIが作成しています。公開前に事実確認を行ってください。</p>
          <span className={`engine-badge engine-badge--${dashboard.meta.mode}`}>
            <i />
            {loading ? '提案を準備中…' : dashboard.meta.mode === 'openai' ? 'OpenAI 生成済み' : 'テンプレート生成済み'}
          </span>
        </footer>
      </main>

      {selectedSuggestion && (
        <SuggestionModal
          key={selectedSuggestion.id}
          suggestion={selectedSuggestion}
          onClose={() => setSelectedSuggestion(null)}
          onUse={useSuggestion}
        />
      )}
      {selectedOpportunity && (
        <PitchModal
          key={selectedOpportunity.id}
          opportunity={selectedOpportunity}
          onClose={() => setSelectedOpportunity(null)}
          onCopy={copyPitch}
        />
      )}
      {generationOpen && (
        <GenerationModal
          busy={actionBusy}
          initial={dashboard.meta.conditions}
          onClose={() => setGenerationOpen(false)}
          onGenerate={regenerate}
        />
      )}
      {historyOpen && (
        <HistoryPanel
          items={history}
          loading={historyLoading}
          onClose={() => setHistoryOpen(false)}
          onLoad={loadHistoryItem}
        />
      )}
      {toast && <div className="toast" role="status"><Icon name="check" size={17} />{toast}</div>}
    </div>
  );
}

type PrPage = 'dashboard' | 'recommend';

function daysSince(value: string): number | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function HeaderCompanySwitcher({
  companies,
  loading,
  profileLoading,
  selectedCompanyId,
  onSelect,
  onViewProfile,
}: {
  companies: CompanySummary[];
  loading: boolean;
  profileLoading: boolean;
  selectedCompanyId?: string;
  onSelect: (companyId: string) => void;
  onViewProfile: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);
  const [cachedOnly, setCachedOnly] = useState(true);
  const selected = companies.find((company) => company.id === selectedCompanyId) ?? companies[0];
  const filteredCompanies = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP');
    return companies.filter((company) => {
      const staleDays = daysSince(company.lastPublishedAt);
      const matchesStale = !staleOnly || (staleDays !== null && staleDays >= 30);
      const matchesCache = !cachedOnly || company.hasCachedRecommendation;
      const matchesQuery = !normalized || `${company.name} ${company.industry} ${company.id}`
        .toLocaleLowerCase('ja-JP')
        .includes(normalized);
      return matchesStale && matchesCache && matchesQuery;
    }).slice(0, 100);
  }, [cachedOnly, companies, query, staleOnly]);

  return (
    <div className="pr-company-switcher">
      <button
        className="pr-company-profile-link"
        disabled={loading || !selected || profileLoading}
        onClick={onViewProfile}
        type="button"
      >
        <Icon name="building" size={13} /> {profileLoading ? '企業情報を読み込み中…' : '企業情報を見る'} <Icon name="arrow" size={13} />
      </button>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="pr-account"
        disabled={loading || !selected}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="pr-account__avatar">{selected?.initials ?? '企'}</span>
        <span className="pr-account__identity">
          <strong>{selected?.name ?? '企業を読み込み中'}</strong>
          <small>{selected ? `企業ID：${selected.id}` : 'しばらくお待ちください'}</small>
        </span>
        <Icon name="chevron" size={15} />
      </button>
      {open && (
        <>
          <button className="pr-company-switcher__scrim" onClick={() => setOpen(false)} type="button" aria-label="企業選択を閉じる" />
          <section className="pr-company-menu" aria-label="企業を切り替える">
            <div className="pr-company-menu__heading">
              <div><small>ANALYSIS COMPANY</small><h2>企業を切り替える</h2></div>
              <button onClick={() => setOpen(false)} type="button" aria-label="閉じる"><Icon name="x" size={18} /></button>
            </div>
            <input
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="企業名・業種・企業IDで検索"
              type="search"
              value={query}
            />
            <label className="pr-company-menu__filter">
              <input checked={cachedOnly} onChange={(event) => setCachedOnly(event.target.checked)} type="checkbox" />
              <span>提案キャッシュがある企業のみ</span>
              <small>{companies.filter((company) => company.hasCachedRecommendation).length}社</small>
            </label>
            <label className="pr-company-menu__filter">
              <input checked={staleOnly} onChange={(event) => setStaleOnly(event.target.checked)} type="checkbox" />
              <span>30日以上投稿が止まっている企業のみ</span>
              <small>{companies.filter((company) => (daysSince(company.lastPublishedAt) ?? -1) >= 30).length}社</small>
            </label>
            <div className="pr-company-menu__summary">{filteredCompanies.length}社を表示</div>
            <div className="pr-company-menu__list">
              {filteredCompanies.map((company) => {
                const staleDays = daysSince(company.lastPublishedAt);
                const active = company.id === selected?.id;
                return (
                  <button
                    aria-current={active ? 'true' : undefined}
                    className={active ? 'is-current' : ''}
                    key={company.id}
                    onClick={() => { onSelect(company.id); setOpen(false); }}
                    type="button"
                  >
                    <span className="company-avatar">{company.initials}</span>
                    <span className="pr-company-menu__company">
                      <strong>{company.name}</strong>
                      <small>{company.industry}・配信{company.releaseCount}件</small>
                      <em>最終投稿 {new Date(company.lastPublishedAt).toLocaleDateString('ja-JP')}</em>
                    </span>
                    {company.hasCachedRecommendation && <span className="pr-company-menu__cached">提案あり</span>}
                    {staleDays !== null && staleDays >= 30 && <span className="pr-company-menu__stale">{staleDays}日停止</span>}
                    {active && <Icon name="check" size={17} />}
                  </button>
                );
              })}
              {!loading && filteredCompanies.length === 0 && <p>該当する企業がありません</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function PrHeader({
  companies,
  companiesLoading,
  profileLoading,
  onMenu,
  onSelectCompany,
  onViewCompanyProfile,
  selectedCompanyId,
}: {
  companies: CompanySummary[];
  companiesLoading: boolean;
  profileLoading: boolean;
  onMenu: () => void;
  onSelectCompany: (companyId: string) => void;
  onViewCompanyProfile: () => void;
  selectedCompanyId?: string;
}) {
  return (
    <header className="pr-header">
      <button className="pr-mobile-menu" onClick={onMenu} type="button" aria-label="メニューを開く">☰</button>
      <div className="pr-brand" aria-label="PR TIMES">PR TIMES</div>
      <div className="pr-header-actions">
        <button type="button">メディアリスト新規作成</button>
        <button className="pr-primary-action" type="button">プレスリリース新規作成</button>
      </div>
      <div className="pr-support"><small>サポートデスクはこちら</small><strong>☎ 03-6625-4684</strong></div>
      <button className="pr-contact" type="button">問い合わせフォーム</button>
      <HeaderCompanySwitcher
        companies={companies}
        loading={companiesLoading}
        profileLoading={profileLoading}
        onSelect={onSelectCompany}
        onViewProfile={onViewCompanyProfile}
        selectedCompanyId={selectedCompanyId}
      />
    </header>
  );
}

function PrSidebar({ open, page, onPage }: { open: boolean; page: PrPage; onPage: (page: PrPage) => void }) {
  const [analysisOpen, setAnalysisOpen] = useState(true);
  return (
    <aside className={`pr-sidebar${open ? ' is-open' : ''}`}>
      <nav aria-label="PR TIMESメニュー">
        <button className={page === 'dashboard' ? 'is-active' : ''} onClick={() => onPage('dashboard')} type="button"><span>▦</span>ダッシュボード</button>
        <button type="button"><span>▤</span>プレスリリース<i>›</i></button>
        <button type="button"><span>▤</span>メディアリスト<i>›</i></button>
        <button type="button"><span>▱</span>ストーリー<i>›</i></button>
        <button onClick={() => setAnalysisOpen(!analysisOpen)} type="button"><span>⌁</span>分析データ<i>{analysisOpen ? '⌃' : '⌄'}</i></button>
        {analysisOpen && (
          <div className="pr-subnav">
            <button type="button">レポート</button>
            <button type="button">提携オンラインメディア</button>
            <button type="button">ソーシャル</button>
            <button type="button">広告換算ツール</button>
            <button className={page === 'recommend' ? 'is-current' : ''} onClick={() => onPage('recommend')} type="button">✣ レコメンド <small>NEW</small></button>
          </div>
        )}
        <button type="button"><span>⌕</span>Webクリッピング<i>›</i></button>
        <button type="button"><span>▥</span>企業ページ<i>›</i></button>
      </nav>
    </aside>
  );
}

const DASHBOARD_STALE_AFTER_DAYS = 30;

function DashboardRecommendationBanner({
  companyId,
  onOpenRecommendation,
}: {
  companyId?: string;
  onOpenRecommendation: (layer: RecommendationLayer) => void;
}) {
  const [dashboard, setDashboard] = useState<RecommendationDashboard | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setDashboard(null);
    setLoadError(false);
    const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    fetch(`${apiBaseUrl}/recommendations${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as RecommendationDashboard;
      })
      .then((data) => {
        setDashboard(data);
        setLoadError(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(true);
      });
    return () => controller.abort();
  }, [companyId]);

  const daysSinceLastPublished = dashboard?.meta.daysSinceLastPublished ?? null;
  const isStale = daysSinceLastPublished !== null && daysSinceLastPublished >= DASHBOARD_STALE_AFTER_DAYS;
  const existingSuggestion = dashboard?.existingSuggestions[0];
  const showExistingSuggestion = isStale && Boolean(existingSuggestion);
  const layer: RecommendationLayer = showExistingSuggestion ? 'existing' : 'new';
  const recommendation = showExistingSuggestion ? existingSuggestion : dashboard?.newOpportunities[0];

  return (
    <section className="pr-recommend-banner" aria-label="おすすめのプレスリリース企画">
      <span className="pr-recommend-banner__spark" aria-hidden="true"><Icon name="sparkles" size={22} /></span>
      <div className="pr-recommend-banner__content">
        <h2>PR企画レコメンド</h2>
        {!dashboard && !loadError && (
          <p className="pr-recommend-banner__proposal" role="status">次の発信アイデアを探しています。</p>
        )}
        {loadError && (
          <p className="pr-recommend-banner__proposal">次のプレスリリース企画を見つけませんか？</p>
        )}
        {dashboard && recommendation && (
          <p className="pr-recommend-banner__proposal">{recommendation.title}</p>
        )}
      </div>
      <button
        disabled={!dashboard || !recommendation}
        onClick={() => onOpenRecommendation(layer)}
        type="button"
      >
        {dashboard && recommendation ? '詳しく見る' : '準備中'} <Icon name="arrow" size={17} />
      </button>
    </section>
  );
}

function PrDashboard({
  companyId,
  onOpenRecommendation,
}: {
  companyId?: string;
  onOpenRecommendation: (layer: RecommendationLayer) => void;
}) {
  const [open, setOpen] = useState([true, true]);
  const notices = [
    ['コンテンツ掲載基準を更新しました', '「日本初」「No.1」等の最上級表現の改定や、メディアタイアップ広告に関する基準の新設など、コンテンツ掲載基準を更新しました。'],
    ['WebクリッピングでSNS投稿の取得が可能になりました', '指定したキーワードに基づきSNS上の投稿を毎日自動で取得し、一覧で確認できるようになりました。'],
  ];
  return (
    <div className="pr-dashboard">
      <p className="pr-breadcrumb">ダッシュボード</p>
      <h1>ダッシュボード</h1>
      <DashboardRecommendationBanner companyId={companyId} onOpenRecommendation={onOpenRecommendation} />
      <div className="pr-project"><strong>テスト4</strong><span>⌄　×</span></div>
      {notices.map(([title, body], index) => (
        <article className="pr-notice" key={title}>
          <button onClick={() => setOpen((values) => values.map((value, item) => item === index ? !value : value))} type="button">
            <h2>{title}</h2><span>{open[index] ? '⌃' : '⌄'}　×</span>
          </button>
          {open[index] && <p>{body}</p>}
        </article>
      ))}
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<PrPage>('dashboard');
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companyProfile, setCompanyProfile] = useState<RecommendationCompanyProfile | null>(null);
  const [companyProfileLoading, setCompanyProfileLoading] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('companyId') ?? undefined,
  );
  const [recommendationLayer, setRecommendationLayer] = useState<RecommendationLayer>();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/recommendation-companies`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as { items: CompanySummary[] };
      })
      .then(({ items }) => {
        setCompanies(items);
        setSelectedCompanyId((current) => current && items.some((company) => company.id === current)
          ? current
          : items[0]?.id);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setCompanies([]);
      })
      .finally(() => setCompaniesLoading(false));
    return () => controller.abort();
  }, []);
  const selectCompany = (companyId: string) => {
    setSelectedCompanyId(companyId);
    const url = new URL(window.location.href);
    url.searchParams.set('companyId', companyId);
    window.history.replaceState({}, '', url);
  };
  const openCompanyProfile = async () => {
    if (!selectedCompanyId || companyProfileLoading) return;
    setCompanyProfileLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/recommendation-companies/${encodeURIComponent(selectedCompanyId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCompanyProfile((await response.json()) as RecommendationCompanyProfile);
    } finally {
      setCompanyProfileLoading(false);
    }
  };
  const selectPage = (next: PrPage) => {
    setPage(next);
    setRecommendationLayer(undefined);
    setMobileOpen(false);
  };
  const openRecommendation = (layer: RecommendationLayer) => {
    setRecommendationLayer(layer);
    setPage('recommend');
    setMobileOpen(false);
  };
  return (
    <div className="pr-shell">
      <PrHeader
        companies={companies}
        companiesLoading={companiesLoading}
        profileLoading={companyProfileLoading}
        onMenu={() => setMobileOpen(!mobileOpen)}
        onSelectCompany={selectCompany}
        onViewCompanyProfile={() => void openCompanyProfile()}
        selectedCompanyId={selectedCompanyId}
      />
      {mobileOpen && <button className="pr-scrim" onClick={() => setMobileOpen(false)} type="button" aria-label="メニューを閉じる" />}
      <PrSidebar open={mobileOpen} page={page} onPage={selectPage} />
      <main className="pr-main">
        {page === 'dashboard' ? (
          <PrDashboard companyId={selectedCompanyId} onOpenRecommendation={openRecommendation} />
        ) : (
          <div className="pr-recommend-content">
            <p className="pr-breadcrumb">分析データ　›　レコメンド</p>
            <RecommendationApp companyId={selectedCompanyId} initialLayer={recommendationLayer} />
          </div>
        )}
      </main>
      {companyProfile && (
        <CompanyPanel
          data={companyProfile}
          onClose={() => setCompanyProfile(null)}
        />
      )}
    </div>
  );
}
