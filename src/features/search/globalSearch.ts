import type { AppSnapshot, TodoPriority, TodoState } from '../../domain/domain';

export type AppSearchMatchedField =
  | 'Artifact'
  | 'Description'
  | 'ID'
  | 'Priority'
  | 'Project'
  | 'State'
  | 'Tags'
  | 'Title';

export type TodoSearchResult = {
  kind: 'todo';
  displayId: string;
  excerpt: string;
  matchedFields: AppSearchMatchedField[];
  priority: TodoPriority;
  projectId: number;
  projectName: string;
  state: TodoState;
  tags: string[];
  title: string;
  todoId: number;
};

export type ProjectNotesSearchResult = {
  kind: 'project-notes';
  excerpt: string;
  matchedFields: AppSearchMatchedField[];
  projectId: number;
  projectName: string;
  title: 'Project Notes';
};

export type AppSearchResult = TodoSearchResult | ProjectNotesSearchResult;

type SearchField = {
  label: AppSearchMatchedField;
  score: number;
  text: string;
};

const MAX_RESULTS = 40;

export function searchApp(
  snapshot: AppSnapshot,
  searchValue: string,
  limit = MAX_RESULTS,
): TodoSearchResult[] {
  const query = normalizeSearchText(searchValue);
  if (!query) {
    return [];
  }

  const projectsById = new Map(snapshot.projects.map((project) => [project.id, project]));
  const terms = query.split(' ').filter(Boolean);

  return snapshot.todos
    .map((todo) => {
      const project = projectsById.get(todo.projectId);
      const projectText = [project?.name, project?.client, project?.workingDirectory]
        .filter(Boolean)
        .join(' ');
      const fields: SearchField[] = [
        { label: 'ID', score: 120, text: todo.displayId },
        { label: 'Title', score: 100, text: todo.title },
        { label: 'Project', score: 65, text: projectText },
        { label: 'Tags', score: 58, text: todo.tags.join(' ') },
        { label: 'State', score: 45, text: todo.state },
        { label: 'Priority', score: 40, text: todo.priority },
        { label: 'Description', score: 25, text: todo.descriptionMarkdown },
        { label: 'Artifact', score: 20, text: todo.artifactMarkdown },
      ];
      const haystack = normalizeSearchText(fields.map((field) => field.text).join(' '));

      if (!terms.every((term) => haystack.includes(term))) {
        return null;
      }

      const matchingFields = fields.filter((field) => fieldMatches(field.text, terms, query));
      const matchedFields =
        matchingFields.length > 0
          ? uniqueFields(matchingFields.map((field) => field.label))
          : uniqueFields(
              fields
                .filter((field) =>
                  terms.some((term) => normalizeSearchText(field.text).includes(term)),
                )
                .map((field) => field.label),
            );
      const score =
        matchingFields.reduce((total, field) => total + field.score, 0) +
        (normalizeSearchText(todo.displayId) === query ? 40 : 0);

      return {
        result: {
          kind: 'todo' as const,
          displayId: todo.displayId,
          excerpt: buildExcerpt(fields, terms, query),
          matchedFields,
          priority: todo.priority,
          projectId: todo.projectId,
          projectName: project?.name ?? 'Unknown project',
          state: todo.state,
          tags: todo.tags,
          title: todo.title,
          todoId: todo.id,
        },
        score,
        updatedAt: new Date(todo.updatedAt).getTime(),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.result.todoId - b.result.todoId)
    .slice(0, limit)
    .map((item) => item.result);
}

function fieldMatches(text: string, terms: string[], query: string): boolean {
  const normalizedText = normalizeSearchText(text);
  return normalizedText.includes(query) || terms.every((term) => normalizedText.includes(term));
}

function uniqueFields(fields: AppSearchMatchedField[]): AppSearchMatchedField[] {
  return Array.from(new Set(fields));
}

function buildExcerpt(fields: SearchField[], terms: string[], query: string): string {
  const bodyField = fields.find(
    (field) =>
      (field.label === 'Description' || field.label === 'Artifact') &&
      fieldMatches(field.text, terms, query),
  );
  const fallbackField = fields.find((field) => fieldMatches(field.text, terms, query));
  const source = bodyField?.text || fallbackField?.text || '';
  const compactSource = source.replace(/\s+/g, ' ').trim();
  if (!compactSource) {
    return '';
  }

  const normalizedSource = normalizeSearchText(compactSource);
  const matchIndex = normalizedSource.indexOf(query);
  const firstTermIndex = terms
    .map((term) => normalizedSource.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const index = matchIndex >= 0 ? matchIndex : (firstTermIndex ?? 0);
  const start = Math.max(0, index - 42);
  const end = Math.min(compactSource.length, index + query.length + 90);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < compactSource.length ? '...' : '';

  return `${prefix}${compactSource.slice(start, end)}${suffix}`;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
