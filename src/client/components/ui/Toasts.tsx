import { dismissToast, useToasts } from '../../lib/toast.ts';
import { Close } from '../Icons.tsx';

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.message}</span>
          <button type="button" className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <Close size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
