import { motion, type HTMLMotionProps } from 'framer-motion';
import { type MouseEvent, useEffect, useRef } from 'react';

type DialogBackdropProps = Omit<HTMLMotionProps<'div'>, 'className'> & {
  className?: string;
  persistent?: boolean;
};

type DialogPanelProps = Omit<HTMLMotionProps<'section'>, 'className' | 'onCancel'> & {
  className?: string;
  onCancel?: () => void;
  persistent?: boolean;
};

type EscapeCancelEntry = {
  cancel: () => void;
  id: symbol;
};

const escapeCancelStack: EscapeCancelEntry[] = [];
let isEscapeCancelListenerActive = false;

export function DialogBackdrop({
  children,
  className,
  onClick,
  persistent = false,
  ...props
}: DialogBackdropProps) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    onClick?.(event);

    if (persistent || event.defaultPrevented || event.target !== event.currentTarget) {
      return;
    }

    cancelTopmostDialog();
  };

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={classNames('dialog-backdrop', className)}
      initial={{ opacity: 0 }}
      onClick={handleClick}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function DialogPanel({
  children,
  className,
  onCancel,
  persistent = false,
  ...props
}: DialogPanelProps) {
  useEscapeToCancel(onCancel, persistent);

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className={classNames('dialog-panel', className)}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      {...props}
    >
      {children}
    </motion.section>
  );
}

export function useEscapeToCancel(onCancel?: () => void, persistent = false) {
  const idRef = useRef<symbol | null>(null);
  const onCancelRef = useRef(onCancel);
  const cancelEnabled = Boolean(onCancel) || persistent;

  if (!idRef.current) {
    idRef.current = Symbol('dialog-cancel');
  }

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!cancelEnabled || !idRef.current) {
      return undefined;
    }

    const entry: EscapeCancelEntry = {
      cancel: () => {
        if (persistent) {
          return;
        }
        onCancelRef.current?.();
      },
      id: idRef.current,
    };

    escapeCancelStack.push(entry);
    ensureEscapeCancelListener();

    return () => {
      const index = escapeCancelStack.findIndex((candidate) => candidate.id === entry.id);
      if (index >= 0) {
        escapeCancelStack.splice(index, 1);
      }

      if (escapeCancelStack.length === 0) {
        document.removeEventListener('keydown', handleEscapeKeyDown);
        isEscapeCancelListenerActive = false;
      }
    };
  }, [cancelEnabled, persistent]);
}

function classNames(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function ensureEscapeCancelListener() {
  if (isEscapeCancelListenerActive) {
    return;
  }

  document.addEventListener('keydown', handleEscapeKeyDown);
  isEscapeCancelListenerActive = true;
}

function handleEscapeKeyDown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.key !== 'Escape' ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }

  const topmostDialog = escapeCancelStack.at(-1);
  if (!topmostDialog) {
    return;
  }

  event.preventDefault();
  cancelTopmostDialog();
}

function cancelTopmostDialog() {
  const topmostDialog = escapeCancelStack.at(-1);
  topmostDialog?.cancel();
}
