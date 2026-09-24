import type { ReactNode } from 'react';

interface MenuItemProps {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  danger?: boolean;
  /** Renders a switch on the right, for on/off items. */
  checked?: boolean;
}

export function MenuItem({ icon, children, onClick, disabled, hint, danger, checked }: MenuItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      className={`menu-item${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span className="menu-item-text">
        {children}
        {hint && <span className="menu-item-hint">{hint}</span>}
      </span>
      {checked !== undefined && (
        <span className={`switch switch-sm${checked ? ' is-on' : ''}`} aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      )}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}

const HUES = [212, 262, 330, 20, 150, 185, 45, 290];

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!].map((w) => Array.from(w)[0]) : Array.from(words[0] ?? '?').slice(0, 2);
  return letters.join('').toUpperCase();
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  const hue = HUES[hash % HUES.length]!;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 70% 62% / 0.2)`, color: `hsl(${hue} 85% 72%)` }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
