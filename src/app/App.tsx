import { useSearch } from '@tanstack/react-router';

import { ImageWindow } from '../features/image/ImageWindow';
import { DetachedTerminalWindow } from '../features/terminal/DetachedTerminalWindow';
import { MainApp } from './MainApp';

export function App() {
  const search = useSearch({ from: '/' });

  if (search.ptyId) {
    return (
      <DetachedTerminalWindow
        attachmentTarget={
          search.projectId && search.todoId
            ? { projectId: search.projectId, todoId: search.todoId }
            : undefined
        }
        ptyId={search.ptyId}
        title={search.terminalTitle ?? `Terminal ${search.ptyId}`}
      />
    );
  }

  if (search.imageWindow && search.imageSrc) {
    return <ImageWindow src={search.imageSrc} />;
  }

  return <MainApp />;
}
