import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell.js';
import { DashboardPage } from '../pages/dashboard/DashboardPage.js';
import { DocumentPage } from '../pages/document/DocumentPage.js';
import { JobsPage } from '../pages/jobs/JobsPage.js';
import { LibraryPage } from '../pages/library/LibraryPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';
import { ResearchPage } from '../pages/research/ResearchPage.js';
import { SettingsPage } from '../pages/settings/SettingsPage.js';
import { AgentsPage } from '../pages/agents/AgentsPage.js';
import { AgentDetailPage } from '../pages/agents/AgentDetailPage.js';
import { AgentRunPage } from '../pages/agents/AgentRunPage.js';
import { GraphPage } from '../pages/graph/GraphPage.js';
import { WikiConflictsPage } from '../pages/wiki/WikiConflictsPage.js';
import { WikiEditPage } from '../pages/wiki/WikiEditPage.js';
import { WikiHistoryPage } from '../pages/wiki/WikiHistoryPage.js';
import { WikiListPage } from '../pages/wiki/WikiListPage.js';
import { WikiPage } from '../pages/wiki/WikiPage.js';
import { WikiProposalPage } from '../pages/wiki/WikiProposalPage.js';
import { WikiReviewPage } from '../pages/wiki/WikiReviewPage.js';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="documents/:id" element={<DocumentPage />} />
          <Route path="research/:id?" element={<ResearchPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/runs/:runId" element={<AgentRunPage />} />
          <Route path="agents/:id" element={<AgentDetailPage />} />
          <Route path="wiki" element={<WikiListPage />} />
          <Route path="wiki/review" element={<WikiReviewPage />} />
          <Route path="wiki/review/:id" element={<WikiProposalPage />} />
          <Route path="wiki/conflicts" element={<WikiConflictsPage />} />
          <Route path="wiki/:slug" element={<WikiPage />} />
          <Route path="wiki/:slug/edit" element={<WikiEditPage />} />
          <Route path="wiki/:slug/history" element={<WikiHistoryPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
