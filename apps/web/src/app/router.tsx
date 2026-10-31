import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell.js';
import { DashboardPage } from '../pages/dashboard/DashboardPage.js';
import { DocumentPage } from '../pages/document/DocumentPage.js';
import { JobsPage } from '../pages/jobs/JobsPage.js';
import { LibraryPage } from '../pages/library/LibraryPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';
import { ResearchPage } from '../pages/research/ResearchPage.js';
import { SettingsPage } from '../pages/settings/SettingsPage.js';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="documents/:id" element={<DocumentPage />} />
          <Route path="research" element={<ResearchPage />} />
          <Route path="research/:id" element={<ResearchPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
