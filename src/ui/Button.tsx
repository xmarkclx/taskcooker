import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant =
  | 'icon'
  | 'primary'
  | 'project'
  | 'secondary'
  | 'start'
  | 'stop'
  | 'toolbar';

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  large?: boolean;
  variant: ButtonVariant;
};

export function AppButton({
  children,
  className,
  large = false,
  type = 'button',
  variant,
  ...props
}: AppButtonProps) {
  const classes = [
    buttonClassByVariant[variant],
    large ? 'large' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  );
}

const buttonClassByVariant: Record<ButtonVariant, string> = {
  icon: 'icon-button',
  primary: 'primary-button',
  project: 'project-button',
  secondary: 'secondary-button',
  start: 'start-button',
  stop: 'stop-button',
  toolbar: 'toolbar-button',
};
