import {
  ClipboardCopy,
  FileCode2,
  Folder,
  Play,
  RefreshCw,
  RotateCcw,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { ProjectActionSummary } from '../../domain/domain';

type ProjectActionIconProps = {
  action: ProjectActionSummary;
  className?: string;
  size?: number;
};

const configuredIcons: Record<string, LucideIcon> = {
  ClipboardCopy,
  FileCode2,
  Folder,
  Play,
  RefreshCw,
  Reinstall: RefreshCw,
  RotateCcw,
  Terminal,
  Wrench,
  Zap,
};

export function ProjectActionIcon({ action, className, size = 16 }: ProjectActionIconProps) {
  const Icon = projectActionIcon(action);

  return (
    <span aria-label={`${action.title} icon`} className={className} role="img">
      <Icon aria-hidden="true" size={size} />
    </span>
  );
}

function projectActionIcon(action: ProjectActionSummary): LucideIcon {
  const configured = action.icon ? configuredIcons[action.icon] : undefined;
  if (configured) {
    return configured;
  }

  if (action.runtime === 'native') {
    return Folder;
  }
  if (action.runtime === 'python') {
    return FileCode2;
  }

  return Terminal;
}
