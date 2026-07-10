import { useMemo, useState } from 'react';
import { Play, X } from 'lucide-react';

import type { ProjectActionSummary } from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import { AppSelect } from '../../ui/Select';

export type ProjectActionArgumentValues = Record<string, string | boolean>;

type ProjectActionRunDialogProps = {
  action: ProjectActionSummary;
  onClose: () => void;
  onRun: (values: ProjectActionArgumentValues) => void;
};

export function ProjectActionRunDialog({
  action,
  onClose,
  onRun,
}: ProjectActionRunDialogProps) {
  const [values, setValues] = useState<ProjectActionArgumentValues>(() =>
    Object.fromEntries(
      action.arguments
        .filter((argument) => argument.kind === 'boolean')
        .map((argument) => [argument.name, false]),
    ),
  );
  const canRun = useMemo(
    () =>
      action.arguments.every((argument) => {
        if (!argument.required) {
          return true;
        }
        const value = values[argument.name];
        return typeof value === 'boolean' || Boolean(String(value ?? '').trim());
      }),
    [action.arguments, values],
  );

  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="run-action-title"
        aria-modal="true"
        className="run-action-dialog"
        onCancel={onClose}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id="run-action-title">Run Action</h2>
            <p>
              {action.title} · {action.fileName}
            </p>
          </div>
          <AppButton aria-label="Close run action" onClick={onClose} variant="icon">
            <X size={16} />
          </AppButton>
        </header>

        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canRun) {
              return;
            }
            onRun(values);
          }}
        >
          {action.arguments.map((argument) => {
            if (argument.kind === 'boolean') {
              return (
                <label className="form-check" key={argument.name}>
                  <input
                    aria-label={argument.label}
                    checked={Boolean(values[argument.name])}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [argument.name]: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{argument.label}</span>
                </label>
              );
            }

            if (argument.kind === 'choice') {
              return (
                <label className="form-field" key={argument.name}>
                  <span>{argument.label}</span>
                  <AppSelect
                    aria-label={argument.label}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [argument.name]: event.target.value,
                      }))
                    }
                    options={[
                      { label: 'Select...', value: '' },
                      ...argument.choices.map((choice) => ({
                        label: choice,
                        value: choice,
                      })),
                    ]}
                    required={argument.required}
                    value={String(values[argument.name] ?? '')}
                  />
                </label>
              );
            }

            return (
              <label className="form-field" key={argument.name}>
                <span>{argument.label}</span>
                <input
                  aria-label={argument.label}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [argument.name]: event.target.value,
                    }))
                  }
                  required={argument.required}
                  value={String(values[argument.name] ?? '')}
                />
              </label>
            );
          })}

          <footer className="dialog-actions">
            <AppButton onClick={onClose} variant="secondary">
              Cancel
            </AppButton>
            <AppButton disabled={!canRun} type="submit" variant="primary">
              <Play size={15} />
              Run Action
            </AppButton>
          </footer>
        </form>
      </DialogPanel>
    </DialogBackdrop>
  );
}
