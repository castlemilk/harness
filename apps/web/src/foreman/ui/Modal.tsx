import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Overlay used by every dialog surface. Escape closes, focus moves in on open
 * and the backdrop click is a dismissal — the wireframes all show an `esc`
 * affordance in the corner.
 */
/**
 * Open dialogs, innermost last. Only the top one answers Escape, so closing a
 * transcript opened from the interventions queue doesn't dismiss both.
 */
const stack: symbol[] = [];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  children,
  width,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width: number;
  label: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const token = useRef<symbol>(Symbol('modal'));

  useEffect(() => {
    if (!open) return;
    const id = token.current;
    stack.push(id);

    // Restore focus to whatever opened the dialog when it closes.
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the dialog rather than letting it walk the shell behind.
      const root = panel.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey, true);
    panel.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKey, true);
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
      opener?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="overflow-hidden rounded-[10px] border border-edge bg-canvas text-ink shadow-[0_6px_22px_rgba(0,0,0,.45)] outline-none"
        style={{ width, maxWidth: '100%' }}
      >
        {children}
      </div>
    </div>
  );
}

/** The label + control pairing used throughout the dialogs. */
export function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

const CONTROL =
  'w-full rounded-md border border-edge bg-card px-2.5 py-2 text-[11.5px] text-ink2 outline-none focus:border-accent/50';

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); }}
      className={`${CONTROL} ${mono ? 'font-mono' : ''} placeholder:text-muted`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => { onChange(e.target.value); }}
      className={`${CONTROL} resize-none leading-relaxed`}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  mono,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  mono?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => { onChange(e.target.value as T); }}
        className={`${CONTROL} cursor-pointer appearance-none pr-7 ${mono ? 'font-mono' : ''}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-card">
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-2 text-muted">⌄</span>
    </div>
  );
}

/** Pill switch used for the permission rows. */
export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => { onChange(!on); }}
      className={`relative h-[15px] w-[26px] flex-none rounded-full transition-colors ${
        on ? 'bg-ok' : 'bg-track'
      }`}
    >
      <span
        className={`absolute top-0.5 h-[11px] w-[11px] rounded-full transition-all ${
          on ? 'left-[13px] bg-canvas' : 'left-0.5 bg-muted'
        }`}
      />
    </button>
  );
}
