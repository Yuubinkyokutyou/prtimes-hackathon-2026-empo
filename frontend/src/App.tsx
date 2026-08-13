import { useEffect, useState } from 'react';

type Health = {
  status: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

export function App() {
  const [health, setHealth] = useState<'loading' | 'online' | 'offline'>('loading');

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiBaseUrl}/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as Health;
      })
      .then((data) => setHealth(data.status === 'ok' ? 'online' : 'offline'))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setHealth('offline');
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">TEAM EMPO</p>
        <h1>開発環境の準備ができました。</h1>
        <p className="description">
          React、Node.js / TypeScript、PostgreSQL を Docker Compose で実行しています。
        </p>
        <div className={`status status--${health}`} role="status">
          <span className="status__dot" aria-hidden="true" />
          {health === 'loading' && 'API に接続しています…'}
          {health === 'online' && 'API は正常に稼働しています'}
          {health === 'offline' && 'API に接続できません'}
        </div>
      </section>
    </main>
  );
}
