import { fireEvent, render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "../../domain/domain";
import { terminalWindowFocusRestoreNonceAtom } from "../terminal/terminalFocusState";
import { TopBar } from "./TopBar";

const projects: ProjectSummary[] = [
  {
    id: 1,
    name: "tmatrix",
    client: "",
    workingDirectory: "~/p/tmatrix",
    displayIdPrefix: "T",
    actionsDirectory: ".boomerang/actions",
    projectFolderOpenApp: "cursor",
    mainBranch: "main",
    terminalWslEnabled: false,
    backgroundImagePath: "",
    notesMarkdown: "# tmatrix notes",
    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: "task",
    activeTodoCount: 19,
    status: "Active",
    inheritParent: false,
    subprojects: [],
  },
  {
    id: 2,
    name: "life",
    client: "",
    workingDirectory: "~/p/life",
    displayIdPrefix: "LIFE",
    actionsDirectory: ".boomerang/actions",
    projectFolderOpenApp: "cursor",
    mainBranch: "main",
    terminalWslEnabled: false,
    backgroundImagePath: "",
    notesMarkdown: "",
    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: "task",
    activeTodoCount: 3,
    status: "Active",
    inheritParent: false,
    subprojects: [],
  },
];

type TopBarProps = ComponentProps<typeof TopBar>;

function renderTopBar(overrides: Partial<TopBarProps> = {}) {
  const noop = vi.fn();
  const props: TopBarProps = {
    canCreateTask: true,
    canGoBack: false,
    canGoForward: false,
    lastStoppedTimer: null,
    onCopyActionPrompt: noop,
    onDeleteAction: noop,
    onEditAction: noop,
    onGoBack: noop,
    onGoForward: noop,
    onGoHome: noop,
    onNewActionTask: noop,
    onNewProject: noop,
    onNewTask: noop,
    onNewWorktreeTask: noop,
    onOpenAppSettings: noop,
    onOpenGlobalSearch: noop,
    onOpenProjectActions: noop,
    onOpenProjectFolder: noop,
    onOpenProjectNotes: noop,
    onOpenProjectSettings: noop,
    onOpenProjectWindow: noop,
    onProjectSelect: noop,
    onRefreshActions: noop,
    onRunAction: noop,
    onStartRunningTimer: noop,
    onStopRunningTimer: noop,
    onThemeToggle: noop,
    onTimerTaskSelect: noop,
    project: projects[0],
    projectActions: [],
    projects,
    resolvedTheme: "light",
    runningTimer: null,
    selectedProjectId: 1,
    themePreference: "light",
    ...overrides,
  };

  return render(<TopBar {...props} />);
}

describe("TopBar project picker", () => {
  beforeEach(() => {
    getDefaultStore().set(terminalWindowFocusRestoreNonceAtom, 0);
  });

  it("delegates project window opens to the app shell", () => {
    const onOpenProjectWindow = vi.fn();
    renderTopBar({ onOpenProjectWindow });

    fireEvent.click(screen.getByLabelText(/select project: tmatrix/i));
    fireEvent.click(screen.getByLabelText("Open life in new window"));

    expect(onOpenProjectWindow).toHaveBeenCalledWith(projects[1]);
  });

  it("requests terminal focus restoration before opening the project folder", () => {
    const onOpenProjectFolder = vi.fn();
    renderTopBar({ onOpenProjectFolder });

    fireEvent.click(screen.getByRole("button", { name: "Open project folder" }));

    expect(getDefaultStore().get(terminalWindowFocusRestoreNonceAtom)).toBe(1);
    expect(onOpenProjectFolder).toHaveBeenCalledOnce();
  });
});
