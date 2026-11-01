import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useWikiReviewTasks } from '../../features/hooks.js';
import { useTheme, type ThemeMode } from '../../lib/theme.js';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const NAV: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: <Icon path="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />,
  },
  { to: '/library', label: '知识库', icon: <Icon path="M4 5h16v4H4zM4 12h16v7H4z" /> },
  { to: '/research', label: '问答', icon: <Icon path="M4 5h16v11H8l-4 4z" /> },
  { to: '/wiki', label: 'Wiki', icon: <Icon path="M4 4h16v16H4zM4 9h16M9 9v11" /> },
  { to: '/jobs', label: '任务', icon: <Icon path="M5 7h14M5 12h14M5 17h9" /> },
  {
    to: '/settings',
    label: '设置',
    icon: <Icon path="M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2m12 0h2M12 4v2m0 12v2" />,
  },
];

const THEME_LABELS: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

export function AppShell() {
  const navigate = useNavigate();
  const { mode, cycleMode } = useTheme();
  const reviewTasks = useWikiReviewTasks('open');
  const pendingReviews = reviewTasks.data?.length ?? 0;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const results = useMemo(() => {
    const value = query.trim().toLowerCase();
    return NAV.filter((item) => value === '' || item.label.toLowerCase().includes(value));
  }, [query]);

  const go = (to: string) => {
    setPaletteOpen(false);
    setQuery('');
    navigate(to);
  };

  return (
    <div className="app">
      <nav className="rail" aria-label="主导航">
        <div className="brand" aria-hidden="true">
          K
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className="navbtn"
            aria-label={item.label}
            style={{ position: 'relative' }}
          >
            {item.icon}
            {item.to === '/wiki' && pendingReviews > 0 ? (
              <span
                aria-label={`${pendingReviews} 条待审核`}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  background: 'var(--danger)',
                  color: '#fff',
                  fontSize: 10,
                  lineHeight: '14px',
                  borderRadius: 7,
                  padding: '0 4px',
                }}
              >
                {pendingReviews > 20 ? '20+' : pendingReviews}
              </span>
            ) : null}
            <span className="tip">{item.label}</span>
          </NavLink>
        ))}
        <div className="spacer" />
        <button
          type="button"
          className="navbtn"
          onClick={cycleMode}
          aria-label={`主题：${THEME_LABELS[mode]}`}
          title={`主题：${THEME_LABELS[mode]}`}
        >
          <Icon path="M12 3a9 9 0 109 9 7 7 0 01-9-9z" />
        </button>
      </nav>

      <main className="main">
        <Outlet />
      </main>

      {paletteOpen ? (
        <>
          <div className="drawer-scrim" onClick={() => setPaletteOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            style={{
              position: 'fixed',
              top: '18vh',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'min(520px, 92vw)',
              background: 'var(--paper-0)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-p)',
              boxShadow: 'var(--shadow-overlay)',
              zIndex: 52,
              padding: 12,
            }}
          >
            <input
              autoFocus
              className="input"
              placeholder="跳转到页面…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ width: '100%' }}
            />
            <div className="stack" style={{ marginTop: 8, gap: 2 }}>
              {results.map((item) => (
                <button
                  key={item.to}
                  type="button"
                  className="side-item"
                  onClick={() => go(item.to)}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
              {results.length === 0 ? <p className="tiny muted">没有匹配项</p> : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
