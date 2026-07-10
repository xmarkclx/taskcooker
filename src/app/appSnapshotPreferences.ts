import type { QueryClient } from '@tanstack/react-query';

import type { AppSnapshot, TodoSummary } from '../domain/domain';
import {
  updateTodoPanelVisibilityLocally,
  updateTodoTocVisibilityLocally,
} from '../domain/snapshotActions';
import { queryKeys } from '../tauri/queryKeys';

type SnapshotMutation<TInput> = (
  input: TInput,
  options: { onError: () => void },
) => void;
export type TodoTocVisibilityTarget = 'description' | 'artifact';

type SnapshotPreferenceArgs<TInput> = {
  input: TInput;
  mutate: SnapshotMutation<TInput>;
  optimistic: AppSnapshot;
  previewFallbacksEnabled: boolean;
  queryClient: QueryClient;
  setLocalSnapshot: (snapshot: AppSnapshot) => void;
  snapshot: AppSnapshot;
};

function updateAppSnapshotPreference<TInput>({
  input,
  mutate,
  optimistic,
  previewFallbacksEnabled,
  queryClient,
  setLocalSnapshot,
  snapshot,
}: SnapshotPreferenceArgs<TInput>) {
  queryClient.setQueryData(queryKeys.appSnapshot(), optimistic);
  setLocalSnapshot(optimistic);
  mutate(input, {
    onError: () => {
      if (previewFallbacksEnabled) {
        return;
      }
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
}

export function updateTodoPanelVisibilityPreference(
  args: Omit<
    SnapshotPreferenceArgs<{
      todoId: number;
      descriptionPanelHidden: boolean;
      executionPanelHidden: boolean;
    }>,
    'input' | 'optimistic'
  > & {
    todo: TodoSummary;
    visibility: {
      descriptionPanelHidden: boolean;
      executionPanelHidden: boolean;
    };
  },
) {
  updateAppSnapshotPreference({
    ...args,
    input: {
      todoId: args.todo.id,
      ...args.visibility,
    },
    optimistic: updateTodoPanelVisibilityLocally(
      args.snapshot,
      args.todo.id,
      args.visibility,
    ),
  });
}

export function updateTodoTocVisibilityPreference(
  args: Omit<
    SnapshotPreferenceArgs<{
      todoId: number;
      descriptionTocHidden: boolean;
      artifactTocHidden: boolean;
    }>,
    'input' | 'optimistic'
  > & {
    todo: TodoSummary;
    visibility: {
      descriptionTocHidden: boolean;
      artifactTocHidden: boolean;
    };
  },
) {
  updateAppSnapshotPreference({
    ...args,
    input: {
      todoId: args.todo.id,
      ...args.visibility,
    },
    optimistic: updateTodoTocVisibilityLocally(
      args.snapshot,
      args.todo.id,
      args.visibility,
    ),
  });
}

export function todoTocVisibilityWithChange(
  todo: TodoSummary,
  target: TodoTocVisibilityTarget,
  hidden: boolean,
) {
  return {
    artifactTocHidden: target === 'artifact' ? hidden : todo.artifactTocHidden ?? true,
    descriptionTocHidden:
      target === 'description' ? hidden : todo.descriptionTocHidden ?? true,
  };
}
