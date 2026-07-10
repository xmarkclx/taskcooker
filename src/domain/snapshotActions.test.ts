import { describe, expect, it } from 'vitest';

import { seedSnapshot } from '../data/seed';
import {
  acceptTodoDone,
  createProjectLocally,
  createTodoLocally,
  markTodoMessagesReadLocally,
  messageTodoLocally,
  recordPromptCopiedLocally,
  requestTodoChanges,
  startTaskTimer,
  startClaudeSession,
  stopTaskTimer,
  stopRunningSession,
  updateProjectNotesLocally,
  updateProjectSettingsLocally,
  updateTodoTitleLocally,
  updateTodoPriorityLocally,
} from './snapshotActions';

describe('snapshot actions', () => {
  it('accepts a review task as done without mutating the original snapshot', () => {
    const next = acceptTodoDone(seedSnapshot, 128, {
      now: '2026-06-20T12:00:00Z',
    });

    expect(next).not.toBe(seedSnapshot);
    expect(seedSnapshot.todos.find((todo) => todo.id === 128)?.state).toBe(
      'Ready to Test',
    );
    expect(next.todos.find((todo) => todo.id === 128)).toMatchObject({
      state: 'Done',
      updatedAt: '2026-06-20T12:00:00Z',
    });
    expect(next.messages.at(-1)).toMatchObject({
      actorName: 'Mark',
      actorType: 'human',
      body: 'Accepted as done.',
      todoId: 128,
    });
  });

  it('requests changes and records the decision on the task', () => {
    const next = requestTodoChanges(seedSnapshot, 128, {
      now: '2026-06-20T12:05:00Z',
    });

    expect(next.todos.find((todo) => todo.id === 128)).toMatchObject({
      state: 'Delegated',
      updatedAt: '2026-06-20T12:05:00Z',
    });
    expect(next.messages.at(-1)?.body).toBe('Requested changes.');
  });

  it('records prompt copy events locally for browser fallback mode', () => {
    const next = recordPromptCopiedLocally(seedSnapshot, 128);

    expect(next.todos.find((todo) => todo.id === 128)?.events[0]).toMatchObject(
      {
        actorName: 'Mark',
        actorType: 'human',
        eventType: 'prompt_copied',
      },
    );
  });

  it('removes the running session for the selected task', () => {
    const next = stopRunningSession(seedSnapshot, 128, {
      now: '2026-06-20T12:10:00Z',
    });

    expect(next.sessions.some((session) => session.id === 'session-1')).toBe(
      false,
    );
  });

  it('starts a Claude session once for a task without a running session', () => {
    const next = startClaudeSession(seedSnapshot, 133, {
      now: '2026-06-20T12:15:00Z',
      sessionId: 'session-new',
    });
    const duplicate = startClaudeSession(next, 133, {
      now: '2026-06-20T12:16:00Z',
      sessionId: 'session-duplicate',
    });

    expect(
      next.sessions.find((session) => session.id === 'session-new'),
    ).toMatchObject({
      elapsedLabel: '0m',
      provider: 'Claude',
      state: 'running',
      todoId: 133,
      workingDirectory: '~/p/tmatrix',
    });
    expect(
      duplicate.sessions.filter(
        (session) => session.todoId === 133 && session.state === 'running',
      ),
    ).toHaveLength(1);
  });

  it('tracks the running timer locally for browser fallback mode', () => {
    const stopped = stopTaskTimer(seedSnapshot);
    const restarted = startTaskTimer(stopped, 133);

    expect(stopped.runningTimer).toBeNull();
    expect(restarted.runningTimer).toMatchObject({
      displayId: 'T-133',
      elapsedSeconds: 0,
      title: 'Create project action',
      todoId: 133,
    });
  });

  it('creates a todo locally with the next stable display id for browser fallback mode', () => {
    const next = createTodoLocally(seedSnapshot, {
      projectId: 1,
      title: '  Create new task from UI  ',
      descriptionMarkdown: 'Created through the app.',
    });

    const created = next.todos.find((todo) => todo.id === next.selectedTodoId);

    expect(created).toMatchObject({
      displayId: 'T-134',
      priority: 'None',
      state: 'To Do',
      title: 'Create new task from UI',
    });
    expect(next.projects[0]?.activeTodoCount).toBe(
      seedSnapshot.projects[0].activeTodoCount + 1,
    );
  });

  it('creates and selects a project locally for browser fallback mode', () => {
    const next = createProjectLocally(seedSnapshot, {
      displayIdPrefix: 'NW',
      name: 'New Workspace',
      workingDirectory: '~/p/new-workspace',
    });

    const project = next.projects.find((item) => item.name === 'New Workspace');

    expect(project).toMatchObject({
      actionsDirectory: 'actions',
      activeTodoCount: 0,
      status: 'Active' as const,
      inheritParent: false,
      subprojects: [],      client: '',
      displayIdPrefix: 'NW',
      projectFolderOpenApp: 'cursor',
      workingDirectory: '~/p/new-workspace',
    });
    expect(next.selectedProjectId).toBe(project?.id);
    expect(next.selectedTodoId).toBe(0);
  });

  it('updates priority locally for browser fallback mode', () => {
    const next = updateTodoPriorityLocally(seedSnapshot, 128, 'Urgent', {
      now: '2026-06-20T12:20:00Z',
    });

    expect(next.todos.find((todo) => todo.id === 128)).toMatchObject({
      priority: 'Urgent',
      updatedAt: '2026-06-20T12:20:00Z',
    });
  });

  it('updates title locally for browser fallback mode', () => {
    const next = updateTodoTitleLocally(
      seedSnapshot,
      128,
      'Document MCP handoff',
      {
        now: '2026-06-20T12:22:00Z',
      },
    );

    expect(next.todos.find((todo) => todo.id === 128)).toMatchObject({
      title: 'Document MCP handoff',
      updatedAt: '2026-06-20T12:22:00Z',
    });
  });

  it('updates project notes locally for browser fallback mode', () => {
    const next = updateProjectNotesLocally(
      seedSnapshot,
      1,
      '# Notes\n\nKeep token stable.',
    );

    expect(next.projects[0]).toMatchObject({
      id: 1,
      notesMarkdown: '# Notes\n\nKeep token stable.',
    });
  });

  it('updates project settings locally for browser fallback mode', () => {
    const next = updateProjectSettingsLocally(seedSnapshot, {
      projectId: 1,
      name: 'tmatrix app',
      client: 'Acme Studio',
      workingDirectory: '/Users/markcl/p/tmatrix',
      displayIdPrefix: 'TM',
      actionsDirectory: 'actions',
      projectFolderOpenApp: 'Finder',
      mainBranch: 'main',
      terminalWslEnabled: true,
    });

    expect(next.projects[0]).toMatchObject({
      name: 'tmatrix app',
      client: 'Acme Studio',
      workingDirectory: '/Users/markcl/p/tmatrix',
      displayIdPrefix: 'TM',
      actionsDirectory: 'actions',
      projectFolderOpenApp: 'Finder',
      terminalWslEnabled: true,
    });
  });

  it('adds a local human message for browser fallback mode', () => {
    const next = messageTodoLocally(
      seedSnapshot,
      {
        todoId: 128,
        message: 'Please retry with a stable token.',
        conversationId: 'codex-demo',
      },
      {
        now: '2026-06-20T12:25:00Z',
      },
    );

    expect(next.messages.at(-1)).toMatchObject({
      actorName: 'Mark',
      actorType: 'human',
      body: 'Please retry with a stable token.',
      delivery: 'Sent to Claude session',
      todoId: 128,
    });
  });

  it('marks local unread messages read for one task', () => {
    const next = markTodoMessagesReadLocally(seedSnapshot, 128);

    expect(next.messages.find((message) => message.id === 'm-1')).toMatchObject(
      {
        todoId: 128,
        unread: false,
      },
    );
  });
});
