import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './app/router.js';
import { Providers } from './app/providers.js';
import './styles/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element missing');
}

createRoot(container).render(
  <StrictMode>
    <Providers>
      <AppRouter />
    </Providers>
  </StrictMode>,
);
