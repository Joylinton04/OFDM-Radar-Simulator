import { useEffect, useRef, useState } from 'react';
import Home from './labs/Home';
import SignalsLab from './labs/SignalsLab';
import ModulationLab from './labs/ModulationLab';
import ChannelLab from './labs/ChannelLab';
import OfdmLab from './labs/OfdmLab';
import RadarLab from './labs/RadarLab';
import ArrayLab from './labs/ArrayLab';
import CoopLab from './labs/CoopLab';

export type TabId = 'home' | 'signals' | 'modulation' | 'channel' | 'ofdm' | 'radar' | 'array' | 'coop';

const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Start' },
  { id: 'signals', label: '1 · Signals & Bandwidth' },
  { id: 'modulation', label: '2 · Modulation' },
  { id: 'channel', label: '3 · Channel' },
  { id: 'ofdm', label: '4 · OFDM' },
  { id: 'radar', label: '5 · OFDM Radar' },
  { id: 'array', label: '6 · Antenna Arrays' },
  { id: 'coop', label: '7 · Cooperative ISAC' },
];

function readHash(): TabId {
  const h = window.location.hash.replace('#', '') as TabId;
  return TABS.some((t) => t.id === h) ? h : 'home';
}

type Theme = 'auto' | 'light' | 'dark';

export default function App() {
  const [tab, setTab] = useState<TabId>(readHash);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('theme') as Theme) || 'auto';
    } catch {
      return 'auto';
    }
  });

  useEffect(() => {
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event('themechange'));
  }, [theme]);

  // Expose the header height so sticky toolbars can sit right below it.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = (t: TabId) => {
    window.location.hash = t;
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <header className="top" ref={headerRef}>
        <div className="brand" onClick={() => go('home')}>
          <span className="logo">≋</span> OFDM Radar Lab
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={t.id === tab ? 'on' : ''} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <button
          className="theme-btn"
          title="Toggle colour theme"
          onClick={() => setTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')}
        >
          {theme === 'auto' ? '◐ auto' : theme === 'dark' ? '● dark' : '○ light'}
        </button>
      </header>
      <main>
        {tab === 'home' && <Home go={go} />}
        {tab === 'signals' && <SignalsLab />}
        {tab === 'modulation' && <ModulationLab />}
        {tab === 'channel' && <ChannelLab />}
        {tab === 'ofdm' && <OfdmLab />}
        {tab === 'radar' && <RadarLab />}
        {tab === 'array' && <ArrayLab />}
        {tab === 'coop' && <CoopLab />}
      </main>
    </div>
  );
}
