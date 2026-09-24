import { useSyncExternalStore } from 'react';
import { type Theme, getTheme, saveTheme } from './storage.ts';

const listeners = new Set<() => void>();

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#020617' : '#f4f7fb');
}

export function setTheme(theme: Theme): void {
  saveTheme(theme);
  applyTheme(theme);
  for (const listener of listeners) listener();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getTheme,
  );
}
