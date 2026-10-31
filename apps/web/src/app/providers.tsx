import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '../components/ui.js';
import { createQueryClient } from '../lib/query-client.js';
import { ThemeProvider } from '../lib/theme.js';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
