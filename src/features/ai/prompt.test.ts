import { describe, expect, it } from 'vitest';

import type {
  AppSettingsSummary,
  ProjectSummary,
  TodoSummary,
} from '../../domain/domain';
import { buildTaskPrompt } from './prompt';

describe('buildTaskPrompt', () => {
  it('tells resumed agents to move review tasks back to Delegated before work and Review when finished', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      includeProjectNotes: false,
      project,
      taskDescriptionMode: 'task',
      todo: makeTodo({ state: 'Ready to Test' }),
    });

    expect(prompt).toContain(
      'If you are resuming this task from Ready to Test or Needs Feedback because the user sent follow-up or requested changes, FIRST set T-123 to Delegated before doing any new work.',
    );
    expect(prompt).toContain(
      'When you finish any work pass, immediately move T-123 back to Review: set it to Ready to Test if the user can test the result, or Needs Feedback if you need user input.',
    );
  });

  it('hard-states that the task must be Delegated while working and in Review every time it finishes replying', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      includeProjectNotes: false,
      project,
      taskDescriptionMode: 'task',
      todo: makeTodo({ state: 'To Do' }),
    });

    expect(prompt).toContain(
      'CRITICAL, NON-NEGOTIABLE, EVERY TURN: whenever you are actively working, T-123 MUST be Delegated, and the instant you finish replying it MUST be in "Ready to Test" or "Needs Feedback".',
    );
    expect(prompt).toContain(
      'Never end a reply with T-123 left in To Do, Doing, or Delegated. Every single time the user messages you about this task: FIRST set T-123 to Delegated, do the work, then set it to Ready to Test or Needs Feedback before you finish. No exceptions.',
    );
  });

  it('tells provider agents to pass known native conversation ids through the API', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      includeProjectNotes: false,
      project,
      taskDescriptionMode: 'task',
      todo: makeTodo(),
    });

    expect(prompt).toContain(
      'If Codex or Claude shows a native conversation/session id, include it as the conversationId field in update_todo_state or message_todo arguments.',
    );
  });

  it('uses the Windows curl bridge from WSL without launching the TaskCooker executable', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath: String.raw`C:\Users\xmark\AppData\Local\TaskCooker\boomerang-tasks.exe`,
      includeProjectNotes: false,
      project: { ...project, terminalWslEnabled: true },
      taskDescriptionMode: 'task',
      todo: makeTodo(),
    });

    expect(prompt).toContain('Use the Boomerang HTTP API for updates.');
    expect(prompt).toContain('curl.exe --fail --silent --show-error');
    expect(prompt).toContain(`--data-raw '{"id":1`);
    expect(prompt).toContain('http://127.0.0.1:56810/mcp');
    expect(prompt).toContain('Authorization: Bearer test-token');
    expect(prompt).toContain('"name":"update_todo_state"');
    expect(prompt).toContain('"name":"message_todo"');
    expect(prompt).toContain('"name":"get_todo"');
    expect(prompt).not.toContain('boomerang-tasks.exe');
  });

  it('uses curl.exe for native Windows API calls to avoid the PowerShell curl alias', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath: String.raw`C:\Users\xmark\AppData\Local\TaskCooker\boomerang-tasks.exe`,
      includeProjectNotes: false,
      project,
      taskDescriptionMode: 'task',
      todo: makeTodo(),
    });

    expect(prompt).toContain('curl.exe --fail --silent --show-error');
    expect(prompt).toContain(String.raw`--data-raw '{\"id\":1`);
    expect(prompt).not.toContain('boomerang-tasks.exe');
  });

  it('shares the task artifact file and current artifact contents with every agent prompt', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      includeProjectNotes: false,
      project,
      taskDescriptionMode: 'task',
      todo: makeTodo({
        artifactMarkdown: '# Useful handoff\n\n- Chart: ~/charts/progress.png',
        artifactMarkdownPath:
          '~/Library/Application Support/com.marklopez.boomerangtasks/artifacts/project-1/T-123.md',
      }),
    });

    expect(prompt).toContain('Task artifacts:');
    expect(prompt).toContain(
      'Artifact file: ~/Library/Application Support/com.marklopez.boomerangtasks/artifacts/project-1/T-123.md',
    );
    expect(prompt).toContain(
      'Keep task artifacts updated with durable summaries, charts, graphs, images, Markdown tables, Mermaid diagrams, important links, file links, and FAQ-style answers that another LLM or the user may need later.',
    );
    expect(prompt).toContain('# Useful handoff');
    expect(prompt).toContain('- Chart: ~/charts/progress.png');
  });

  it('puts the task description after durable context so it is easy to edit before sending', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      additionalPrompt: 'Use a small diff.',
      includeProjectNotes: true,
      messages: [
        {
          actorName: 'Mark',
          actorType: 'human',
          body: 'Please keep this running.',
          createdLabel: 'just now',
          delivery: 'Pending for next session',
          id: 'message-1',
          todoId: 123,
        },
      ],
      project: { ...project, notesMarkdown: 'Project note.' },
      taskDescriptionMode: 'task',
      todo: makeTodo({
        artifactMarkdown: '# Prior work\n\n- The data model is already done.',
        artifactMarkdownPath:
          '~/Library/Application Support/com.marklopez.boomerangtasks/artifacts/project-1/T-123.md',
        descriptionMarkdown: 'Final task body.',
      }),
    });

    expect(prompt).toContain(
      'Read the task artifacts before the task description/context; use them as the durable summary of what is going on before you start making changes.',
    );
    expect(prompt.indexOf('Task artifacts:')).toBeLessThan(
      prompt.indexOf('Project notes:'),
    );
    expect(prompt.indexOf('Project notes:')).toBeLessThan(
      prompt.indexOf('Pending human replies:'),
    );
    expect(prompt.indexOf('Pending human replies:')).toBeLessThan(
      prompt.indexOf('Additional instructions:'),
    );
    expect(prompt.indexOf('Additional instructions:')).toBeLessThan(
      prompt.indexOf('Task description:'),
    );
    expect(prompt.trim().endsWith('Final task body.')).toBe(true);
  });

  it('does not include private journal markdown in agent prompts', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      includeProjectNotes: false,
      project,
      taskDescriptionMode: 'task',
      todo: makeTodo({
        descriptionMarkdown: 'Prompt-safe description.',
        journalMarkdown:
          'Private implementation journal. Do not send to the LLM.',
      }),
    });

    expect(prompt).toContain('Prompt-safe description.');
    expect(prompt).not.toContain('Private implementation journal');
  });

  it('uses the todo active working directory when a worktree is enabled', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      includeProjectNotes: false,
      project,
      taskDescriptionMode: 'task',
      todo: makeTodo({
        activeWorkingDirectory: '~/p/T-123-update-prompt-behavior',
        worktreeName: 'T-123-update-prompt-behavior',
        worktreePath: '~/p/T-123-update-prompt-behavior',
      }),
    });

    expect(prompt).toContain(
      'Working directory: ~/p/T-123-update-prompt-behavior',
    );
    expect(prompt).not.toContain('Working directory: ~/p/test');
  });

  it('uses the context project name and notes when a task context is set', () => {
    const prompt = buildTaskPrompt({
      appSettings,
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      contextProject: {
        ...project,
        id: 9,
        name: 'client-site',
        notesMarkdown: 'Context project note.',
        workingDirectory: '~/p/client-site',
      },
      includeProjectNotes: true,
      project: { ...project, notesMarkdown: 'Home project note.' },
      taskDescriptionMode: 'task',
      todo: makeTodo({ activeWorkingDirectory: '~/p/client-site' }),
    });

    expect(prompt).toContain('Project: Test Project');
    expect(prompt).toContain('Context project: client-site');
    expect(prompt).toContain('Working directory: ~/p/client-site');
    expect(prompt).toContain('Context project note.');
    expect(prompt).not.toContain('Home project note.');
  });

  it('includes app-wide context from app settings when present', () => {
    const prompt = buildTaskPrompt({
      appSettings: {
        ...appSettings,
        appContextMarkdown: '# App context\n\nUse MarkSpec docs before coding.',
      },
      binaryPath:
        '/Applications/Boomerang Tasks.app/Contents/MacOS/boomerang-tasks',
      includeProjectNotes: false,
      project,
      taskDescriptionMode: 'task',
      todo: makeTodo(),
    });

    expect(prompt).toContain('App-wide context:');
    expect(prompt).toContain(
      '# App context\n\nUse MarkSpec docs before coding.',
    );
  });
});

const appSettings: AppSettingsSummary = {
  appContextMarkdown: '',
  folderOpenApp: 'code',
  claudePath: 'claude',
  codexPath: 'codex',
  deepLinkFallback: true,
  homeProjectId: 0,
  markdownArtifactTocWidth: 180,
  markdownDescriptionTocWidth: 180,
  markdownEditorFontFamily: 'sans-serif',
  markdownEditorFontSize: '12px',
  markdownEditorMaxImageHeight: 'none',
  markdownEditorMode: 'rich',
  markdownTocHidden: false,
  mcpEnabled: true,
  mcpPort: 56810,
  mcpToken: 'test-token',
  projectAccentBorderWidth: 4,
  slowdownProfilerEnabled: true,
  terminalTmuxEnabled: false,
  externalTerminalOpeners:
    'open -na Ghostty.app --args --command={tmuxCommand}',
  taskTitler: 'codex-spark',
  taskDetailDescriptionWidth: 520,
  taskDetailsRailHidden: false,
  taskListCollapsedProjectIds: [],
  taskListCollapsedSubprojectIds: [],
  taskListCollapsedTodoIds: [],
  taskListWidth: 320,
  theme: 'light',
};

const project: ProjectSummary = {
  actionsDirectory: '.boomerang/actions',
  activeTodoCount: 1,
  status: 'Active' as const,
  inheritParent: false,
  subprojects: [],  aiDefaultIncludeProjectNotes: false,
  aiTaskDescriptionMode: 'task',
  backgroundImagePath: '',
  client: '',
  displayIdPrefix: 'T',
  id: 1,
  name: 'Test Project',
  notesMarkdown: '',
  projectFolderOpenApp: 'cursor',
  mainBranch: 'main',
  terminalWslEnabled: false,
  workingDirectory: '~/p/test',
};

function makeTodo(
  overrides: Partial<TodoSummary> & {
    artifactMarkdown?: string;
    artifactMarkdownPath?: string;
  } = {},
): TodoSummary {
  return {
    artifactMarkdown: '',
    artifactMarkdownPath: '',
    activeWorkingDirectory: '~/p/test',
    deadline: null,
    dependencies: [],
    descriptionMarkdown: 'Task body.',
    displayId: 'T-123',
    events: [],
    id: 123,
    ownTimeSeconds: 0,
    position: 0,
    priority: 'None',
    projectId: 1,
    rolledUpTimeSeconds: 0,
    stale: false,
    state: 'To Do',
    subtasks: [],
    tags: [],
    timeLogs: [],
    title: 'Update prompt behavior',
    updatedAt: '2026-06-21T10:00:00Z',
    ...overrides,
    createdAt: overrides.createdAt ?? '2026-06-21T09:00:00Z',
  };
}
