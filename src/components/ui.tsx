import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { initials } from '../lib/selectors';

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {(title || action) && (
        <div className="panelHeader">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="panelDescription">{description}</p>}
          </div>
          {action && <div className="panelAction">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="pageHeader">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="pageHeaderActions">{actions}</div>}
    </div>
  );
}

export function MetricCard({ title, value, detail, icon }: { title: string; value: string; detail?: ReactNode; icon?: IconName }) {
  return (
    <article className="metricCard">
      <div className="metricTitle">
        {icon && <Icon name={icon} size={16} />}
        <span>{title}</span>
      </div>
      <strong>{value}</strong>
      {detail && <div className="metricDetail">{detail}</div>}
    </article>
  );
}

export function ProgressBar({ value, max, tone }: { value: number; max: number; tone?: 'default' | 'success' | 'warning' }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={`progressTrack progress-${tone || 'default'}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  items,
  disabled,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<[T, string]>;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {items.map(([id, text]) => (
        <button
          type="button"
          key={id}
          className={value === id ? 'segment segmentActive' : 'segment'}
          onClick={() => onChange(id)}
          disabled={disabled}
          aria-pressed={value === id}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="emptyState">
      {icon && <span className="emptyIcon"><Icon name={icon} size={22} /></span>}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={className ? `field ${className}` : 'field'}>
      <span className="fieldName">{label}</span>
      {children}
      {hint && <span className="fieldHint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string }) {
  return (
    <label className="toggleRow">
      <span>
        <span className="toggleLabel">{label}</span>
        {description && <span className="toggleDescription">{description}</span>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function Avatar({ name, image, size = 32 }: { name: string; image?: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }} aria-hidden="true">
      {image ? <img src={image} alt="" /> : initials(name)}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', color }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; color?: string }) {
  return (
    <span className={`badge badge-${tone}`} style={color ? { ['--badge-color' as string]: color } : undefined}>
      {color && <span className="badgeDot" />}
      {children}
    </span>
  );
}

export function IconButton({ icon, label, onClick, className, disabled }: { icon: IconName; label: string; onClick?: () => void; className?: string; disabled?: boolean }) {
  return (
    <button type="button" className={className ? `iconButton ${className}` : 'iconButton'} onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

/** Closes the popover when the user clicks outside it or presses Escape. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

export function Modal({
  title,
  description,
  onClose,
  children,
  width = 440,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.modalClose)')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modalBackdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} ref={dialogRef}>
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="iconButton modalClose" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
