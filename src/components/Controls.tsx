import { ReactNode, createContext, useContext, useId, useState } from 'react';

/** True inside a toolstrip, where the basic controls render in their compact form. */
const InToolstrip = createContext(false);

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
  const inTs = useContext(InToolstrip);
  const RES = 1000;
  const toPos = (v: number) => (log ? (Math.log(v / min) / Math.log(max / min)) * RES : v);
  const fromPos = (p: number) => {
    if (!log) return p;
    const v = min * Math.pow(max / min, p / RES);
    // round to 3 significant digits so values look tidy
    return Number(v.toPrecision(3));
  };
  const input = (
    <input
      id={id}
      type="range"
      min={log ? 0 : min}
      max={log ? RES : max}
      step={log ? 1 : step ?? (max - min) / 200}
      value={toPos(value)}
      onChange={(e) => onChange(fromPos(Number(e.target.value)))}
    />
  );
  if (inTs)
    return (
      <div className="ts-field ts-slider" title={hint}>
        <label htmlFor={id}>
          {label} <span className="ts-val">{format ? format(value) : value}</span>
        </label>
        {input}
      </div>
    );
  return (
    <div className="ctl">
      <div className="ctl-head">
        <label htmlFor={id}>{label}</label>
        <span className="ctl-val">{format ? format(value) : value}</span>
      </div>
      {input}
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

/** Segmented buttons for a small set of options (a dropdown inside a toolstrip). */
export function Choice<T extends string | number>(props: ChoiceProps<T>) {
  const { label, value, options, onChange, format, hint } = props;
  const inTs = useContext(InToolstrip);
  if (inTs) return <TsSelect {...props} />;
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
  const inTs = useContext(InToolstrip);
  if (inTs) return <TsCheck label={label} value={value} onChange={onChange} hint={hint} />;
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
  const inTs = useContext(InToolstrip);
  if (inTs)
    return (
      <TsSection title={title}>
        <div className="ts-grid">{children}</div>
      </TsSection>
    );
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

/* ---------- MATLAB-style toolstrip ---------- */

export interface ToolstripTab {
  id: string;
  label: string;
  content: ReactNode;
}

/** Tabbed ribbon of sections, like the MATLAB desktop toolstrip. */
export function Toolstrip({ tabs, right, active, onTab }: { tabs: ToolstripTab[]; right?: ReactNode; active?: string; onTab?: (id: string) => void }) {
  const [own, setOwn] = useState(tabs[0]?.id);
  const [collapsed, setCollapsed] = useState(false);
  const tab = active ?? own;
  const setTab = onTab ?? setOwn;
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0];
  return (
    <div className={`ts ${collapsed ? 'collapsed' : ''}`}>
      <div className="ts-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === cur.id}
            className={t.id === cur.id ? 'on' : ''}
            onClick={() => {
              setTab(t.id);
              setCollapsed(false);
            }}
            onDoubleClick={() => setCollapsed(!collapsed)}
          >
            {t.label}
          </button>
        ))}
        <div className="ts-tabs-fill">{right}</div>
        <button className="ts-collapse" title={collapsed ? 'Expand toolstrip' : 'Collapse toolstrip'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▾' : '▴'}
        </button>
      </div>
      {!collapsed && (
        <div className="ts-body" role="tabpanel">
          <InToolstrip.Provider value={true}>{cur.content}</InToolstrip.Provider>
        </div>
      )}
    </div>
  );
}

export function TsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ts-sec">
      <div className="ts-sec-body">{children}</div>
      <div className="ts-sec-title">{title}</div>
    </section>
  );
}

/** Vertical stack of small controls inside a section. */
export function TsCol({ children }: { children: ReactNode }) {
  return <div className="ts-col">{children}</div>;
}

export function TsSelect<T extends string | number>({ label, value, options, onChange, format, hint }: ChoiceProps<T>) {
  const id = useId();
  return (
    <div className="ts-field" title={hint}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={String(value)} onChange={(e) => onChange(options.find((o) => String(o) === e.target.value)!)}>
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {format ? format(o) : String(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TsSlider(props: SliderProps) {
  return (
    <InToolstrip.Provider value={true}>
      <Slider {...props} />
    </InToolstrip.Provider>
  );
}

export function TsCheck({ label, value, onChange, hint }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="ts-check" title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Large icon-over-label button. */
export function TsButton({ icon, label, onClick, title, active }: { icon: ReactNode; label: string; onClick: () => void; title?: string; active?: boolean }) {
  return (
    <button className={`ts-btn ${active ? 'on' : ''}`} onClick={onClick} title={title} aria-pressed={active}>
      <span className="ts-ico">{icon}</span>
      <span className="ts-btn-label">{label}</span>
    </button>
  );
}

/** Full-width toolstrip on top, content below. */
export function ToolstripLayout({ toolstrip, children }: { toolstrip: ReactNode; children: ReactNode }) {
  return (
    <div className="lab-ts">
      {toolstrip}
      <div className="lab-main lab-ts-main">{children}</div>
    </div>
  );
}

/** Sub-pages of a lab (e.g. the Channel lab's parts), shown as the toolstrip's tabs. */
export interface LabPages {
  pages: readonly string[];
  current: string;
  onChange: (page: string) => void;
}
export const LabPagesContext = createContext<LabPages | null>(null);

/**
 * Lab page: a toolstrip under the header, content below. Pass `controls` for a
 * single CONTROLS tab, or `tabs` to split them like the MATLAB toolstrip. Inside a
 * LabPagesContext, the tabs switch between the lab's sub-pages instead.
 */
export function LabLayout({ controls, tabs, children }: { controls?: ReactNode; tabs?: ToolstripTab[]; children: ReactNode }) {
  const pages = useContext(LabPagesContext);
  const strip =
    pages && !tabs ? (
      <Toolstrip
        tabs={pages.pages.map((p) => ({ id: p, label: p.toUpperCase(), content: p === pages.current ? controls : null }))}
        active={pages.current}
        onTab={pages.onChange}
      />
    ) : (
      <Toolstrip tabs={tabs ?? [{ id: 'controls', label: 'CONTROLS', content: controls }]} />
    );
  return <ToolstripLayout toolstrip={strip}>{children}</ToolstripLayout>;
}
