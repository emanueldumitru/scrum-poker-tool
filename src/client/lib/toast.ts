import { useSyncExternalStore } from 'react';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function toast(message: string, kind: ToastKind = 'info', durationMs = 3500): void {
  // Collapse duplicates (e.g. repeated "offline" errors while reconnecting).
  if (toasts.some((t) => t.message === message)) return;
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, kind, message }];
  emit();
  window.setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );
}
