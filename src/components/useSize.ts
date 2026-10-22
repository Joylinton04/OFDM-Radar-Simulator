import { useEffect, useRef, useState } from 'react';

/** Track an element's width, so charts redraw when the layout changes. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = Math.floor(entries[0].contentRect.width);
      setW((prev) => (prev === cw ? prev : cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Bumps whenever the colour theme changes, so canvases re-read CSS colours. */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', bump);
    window.addEventListener('themechange', bump);
    return () => {
      mq.removeEventListener('change', bump);
      window.removeEventListener('themechange', bump);
    };
  }, []);
  return v;
}
