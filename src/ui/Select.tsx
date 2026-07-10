import type { SelectHTMLAttributes } from 'react';

export type SelectOption = {
  label: string;
  value: string;
};

type AppSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  options: ReadonlyArray<SelectOption>;
};

export function AppSelect({ className, options, ...props }: AppSelectProps) {
  return (
    <select className={className ?? 'app-select'} {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
