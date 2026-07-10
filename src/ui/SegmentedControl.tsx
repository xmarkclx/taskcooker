import { useId } from 'react';

export type SegmentedOption = {
  label: string;
  value: string;
};

type AppSegmentedControlProps = {
  'aria-label'?: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<SegmentedOption>;
  value: string;
};

export function AppSegmentedControl({
  'aria-label': ariaLabel,
  onChange,
  options,
  value,
}: AppSegmentedControlProps) {
  const groupId = useId();
  return (
    <div aria-label={ariaLabel} className="segment" role="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            aria-checked={active}
            className={active ? 'active' : undefined}
            id={`${groupId}-${option.value}`}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
