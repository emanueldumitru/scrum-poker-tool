import { ROOM_ID_PATTERN } from '../shared/protocol.ts';
import { Logo } from './components/Logo.tsx';
import { Toasts } from './components/ui/Toasts.tsx';
import { navigate, usePathname } from './lib/router.ts';
import { GamePage } from './pages/GamePage.tsx';
import { HomePage } from './pages/HomePage.tsx';

export function App() {
  const path = usePathname();
  const slug = path.replace(/^\/+|\/+$/g, '');

  let page;
  if (!slug) page = <HomePage />;
  else if (ROOM_ID_PATTERN.test(slug)) page = <GamePage key={slug} gameId={slug} />;
  else page = <NotFound />;

  return (
    <>
      {page}
      <Toasts />
    </>
  );
}

function NotFound() {
  return (
    <div className="full-page">
      <main className="full-page-body">
        <Logo size={48} />
        <h1>Page not found</h1>
        <p className="muted">This address is not a game link.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
          Go to the start page
        </button>
      </main>
    </div>
  );
}
