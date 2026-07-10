import type { ProjectSummary, TodoSummary } from '../../domain/domain';

export type ProjectRootRowModel = {
  childCount: number;
  depth: number;
  hasSubtasks: boolean;
  isCollapsed: boolean;
  project: ProjectSummary;
  type: 'project';
};

export type TodoRowModel = {
  depth: number;
  hasSubtasks: boolean;
  isCollapsed: boolean;
  todo: TodoSummary;
  type: 'todo';
};

export type SubprojectRowModel = {
  childTodos: TodoSummary[];
  depth: number;
  isCollapsed: boolean;
  kind: 'subproject' | 'link';
  project: ProjectSummary;
  type: 'subproject';
};

export type TaskRowModel = ProjectRootRowModel | TodoRowModel | SubprojectRowModel;
