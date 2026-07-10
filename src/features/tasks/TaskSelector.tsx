import { ChevronDown } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

export type TaskSelectorOption = {
  id: number;
  displayId: string;
  title: string;
};

type TaskSelectorEntry = {
  id: number | null;
  label: string;
};

type TaskSelectorProps = {
  ariaLabel?: string;
  emptyLabel?: string;
  onChange: (taskId: number | null) => void;
  options: TaskSelectorOption[];
  placeholder?: string;
  value: number | null;
};

/**
 * A reusable searchable combo box for picking a single task from a list.
 * Selecting the empty option clears the value. A `value` that no longer
 * matches any option renders as empty so stale selections fall back to none.
 */
export function TaskSelector({
  ariaLabel = 'Task',
  emptyLabel = 'No parent',
  onChange,
  options,
  placeholder = 'Search tasks…',
  value,
}: TaskSelectorProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedOption = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  );
  const selectedLabel = selectedOption ? optionLabel(selectedOption) : '';

  const entries = useMemo<TaskSelectorEntry[]>(() => {
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? options.filter((option) => optionLabel(option).toLowerCase().includes(normalized))
      : options;
    return [
      { id: null, label: emptyLabel },
      ...matches.map((option) => ({ id: option.id, label: optionLabel(option) })),
    ];
  }, [emptyLabel, options, query]);

  const activeOptionIndex = Math.min(activeIndex, Math.max(entries.length - 1, 0));

  const selectEntry = (entry: TaskSelectorEntry) => {
    onChange(entry.id);
    setQuery('');
    setActiveIndex(0);
    setOpen(false);
  };

  return (
    <div
      className="task-selector"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
          setQuery('');
        }
      }}
    >
      <div className="task-selector-control">
        <input
          aria-activedescendant={
            open ? taskSelectorOptionId(listboxId, activeOptionIndex) : undefined
          }
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          autoComplete="off"
          className="task-selector-input"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery('');
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, Math.max(entries.length - 1, 0)));
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.max(index - 1, 0));
            }

            if (event.key === 'Enter' && open) {
              const entry = entries[activeOptionIndex];
              if (entry) {
                event.preventDefault();
                selectEntry(entry);
              }
            }

            if (event.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          }}
          placeholder={placeholder}
          role="combobox"
          value={open ? query : selectedLabel}
        />
        <ChevronDown aria-hidden size={13} />
      </div>
      {open ? (
        <div className="task-selector-list" id={listboxId} role="listbox">
          {entries.map((entry, index) => (
            <button
              aria-selected={index === activeOptionIndex}
              className="task-selector-option"
              data-empty={entry.id === null ? 'true' : undefined}
              id={taskSelectorOptionId(listboxId, index)}
              key={entry.id ?? 'none'}
              onMouseDown={(event) => {
                event.preventDefault();
                selectEntry(entry);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function optionLabel(option: TaskSelectorOption): string {
  return `${option.displayId} ${option.title}`;
}

function taskSelectorOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}
