import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectSummary } from '../domain/domain';
import {
  getProjectGitRepository,
  listProjectGitHubOwners,
} from '../tauri/commands';
import { useProjectGitHub } from './useProjectGitHub';

vi.mock('../tauri/commands', () => ({
  connectProjectGitHubRepository: vi.fn(),
  getProjectGitRepository: vi.fn(),
  listProjectGitHubOwners: vi.fn(),
  openExternalUrl: vi.fn(),
  pushProjectGitRepository: vi.fn(),
}));

const project: ProjectSummary = {
  actionsDirectory: '.boomerang/actions',
  activeTodoCount: 0,
  aiDefaultIncludeProjectNotes: false,
  aiTaskDescriptionMode: 'task',
  backgroundImagePath: '',
  client: '',
  displayIdPrefix: 'T',
  id: 1,
  inheritParent: false,
  mainBranch: 'main',
  name: 'taskcooker',
  notesMarkdown: '',
  projectFolderOpenApp: 'cursor',
  status: 'Active',
  subprojects: [],
  terminalWslEnabled: false,
  workingDirectory: 'E:\\taskcooker',
};

function Harness({ enabled }: { enabled: boolean }) {
  useProjectGitHub({
    enabled,
    previewFallbacksEnabled: false,
    project,
  });
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useProjectGitHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectGitRepository).mockResolvedValue(null);
    vi.mocked(listProjectGitHubOwners).mockResolvedValue([]);
  });

  it('loads GitHub settings only while Project Settings is open', async () => {
    const view = render(<Harness enabled={false} />, { wrapper: Wrapper });

    expect(getProjectGitRepository).not.toHaveBeenCalled();
    expect(listProjectGitHubOwners).not.toHaveBeenCalled();

    view.rerender(<Harness enabled />);

    await waitFor(() => {
      expect(getProjectGitRepository).toHaveBeenCalledWith({ projectId: 1 });
      expect(listProjectGitHubOwners).toHaveBeenCalledTimes(1);
    });
  });
});
