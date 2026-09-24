import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyTheme } from './lib/theme.ts';
import { getTheme } from './lib/storage.ts';
import './styles/base.css';
import './styles/ui.css';
import './styles/game.css';
import './styles/pages.css';

applyTheme(getTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
