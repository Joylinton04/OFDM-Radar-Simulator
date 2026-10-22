import { ReactNode, useId, useState } from 'react';

interface SliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  log?: boolean; // slider moves on a logarithmic scale
  format?: (v: number) => string;
  hint?: string;
}

/** Labelled slider. With `log`, equal slider movements multiply the value. */
export function Slider({ label, value, onChange, min, max, step, log, format, hint }: SliderProps) {
  const id = useId();
  const RES = 1000;
  const toPos = (v: number) => (log ? (Math.log(v / min) / Math.log(max / min)) * RES : v);
  const fromPos = (p: number) => {
    if (!log) return p;
    const v = min * Math.pow(max / min, p / RES);
    // round to 3 significant digits so values look tidy
    return Number(v.toPrecision(3));
  };
  return (
    <div className="ctl">
      <div className="ctl-head">
        <label htmlFor={id}>{label}</label>
        <span className="ctl-val">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={log ? 0 : min}
        max={log ? RES : max}
        step={log ? 1 : step ?? (max - min) / 200}
        value={toPos(value)}
        onChange={(e) => onChange(fromPos(Number(e.target.value)))}
      />
      {hint && <div className="ctl-hint">{hint}</div>}
    </div>
  );
}

interface ChoiceProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  format?: (v: T) => string;
  hint?: string;
}

/** Segmented buttons for a small set of options. */
export function Choice<T extends string | number>({ label, value, options, onChange, format, hint }: ChoiceProps<T>) {
  return (
    <div className="ctl">
      <div className="ctl-head">
        <span className="ctl-label">{label}</span>
      </div>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o)}
            role="radio"
            aria-checked={o === value}
            className={o === value ? 'on' : ''}
            onClick={() => onChange(o)}
          >
            {format ? format(o) : String(o)}
          </button>
        ))}
      </div>
      {hint && <div className="ctl-hint">{hint}</div>}
    </div>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="ctl">
      <label className="toggle">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && <div className="ctl-hint">{hint}</div>}
    </div>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export type Tone = 'good' | 'warn' | 'bad' | undefined;

export function Metric({ label, value, sub, tone, hint }: { label: string; value: string; sub?: string; tone?: Tone; hint?: string }) {
  return (
    <div className={`metric ${tone ?? ''}`} title={hint}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

export function Metrics({ children }: { children: ReactNode }) {
  return <div className="metrics">{children}</div>;
}

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      {(title || right) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** Collapsible plain-language explanation. */
export function Explain({ title = 'What is going on?', children, open = false }: { title?: string; children: ReactNode; open?: boolean }) {
  const [isOpen, setOpen] = useState(open);
  return (
    <div className={`explain ${isOpen ? 'open' : ''}`}>
      <button className="explain-head" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
        <span>{isOpen ? '▾' : '▸'}</span> {title}
      </button>
      {isOpen && <div className="explain-body">{children}</div>}
    </div>
  );
}

/** "Try this" experiments list. */
export function TryThis({ items }: { items: ReactNode[] }) {
  return (
    <div className="try">
      <div className="try-title">Try this</div>
      <ol>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ol>
    </div>
  );
}

export function Warn({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'bad' | 'info' }) {
  return <div className={`warn ${tone}`}>{children}</div>;
}

export function LabLayout({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  return (
    <div className="lab">
      <aside className="controls">{controls}</aside>
      <div className="lab-main">{children}</div>
    </div>
  );
}
