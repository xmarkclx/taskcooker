import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AppButton } from './Button';

const appStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('AppButton', () => {
  it('maps shared button variants to the design-system classes', () => {
    render(
      <>
        <AppButton variant="icon" aria-label="Open">
          x
        </AppButton>
        <AppButton variant="secondary" large>
          Request changes
        </AppButton>
      </>,
    );

    expect(screen.getByLabelText('Open')).toHaveClass('icon-button');
    expect(screen.getByLabelText('Open')).toHaveAttribute('type', 'button');
    expect(screen.getByText('Request changes')).toHaveClass(
      'secondary-button',
      'large',
    );
  });

  it('centers icon-only content inside the fixed square hit target', () => {
    const iconButtonRules = cssRulesForSelector('.icon-button');

    expect(iconButtonRules).toContain('align-items: center;');
    expect(iconButtonRules).toContain('display: inline-flex;');
    expect(iconButtonRules).toContain('justify-content: center;');
  });

  it('pushes every shared button variant down while pressed', () => {
    const pressableButtonClasses = [
      'icon-button',
      'primary-button',
      'project-button',
      'secondary-button',
      'start-button',
      'stop-button',
      'toolbar-button',
    ];

    for (const buttonClass of pressableButtonClasses) {
      const pressedRules = cssRulesForSelector(
        `.${buttonClass}:not(:disabled):active`,
      );

      expect(pressedRules, buttonClass).toContain(
        'transform: translateY(1px) scale(0.98);',
      );
      expect(pressedRules, buttonClass).toContain(
        'box-shadow: inset 0 2px 3px rgb(var(--color-shadow-rgb) / 24%);',
      );
    }
  });

  it('animates the press only when the user allows motion', () => {
    expect(appStyles).toContain('--button-press-duration:');
    expect(appStyles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?transform var\(--button-press-duration\)/,
    );
  });
});

function cssRulesForSelector(selector: string) {
  const rules = Array.from(appStyles.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^}]*)\}/g));

  return rules
    .filter((match) =>
      match.groups?.selectors
        .split(',')
        .some((candidate) => candidate.trim() === selector),
    )
    .map((match) => match.groups?.body ?? '')
    .join('\n');
}
