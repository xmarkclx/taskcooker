import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { StateBadge } from './taskBadges';

const appStyles = readFileSync('src/styles.css', 'utf8');

describe('task badges', () => {
  it('labels state age as time since entering that state', () => {
    render(<StateBadge ageLabel="4h" state="Ready to Test" />);

    const badge = screen.getByText('Ready to Test since 4h');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('review');
  });

  it('styles blocked status badges with the danger color tokens', () => {
    render(<StateBadge compact state="Blocked" />);

    expect(screen.getByText('BLOCKED')).toHaveClass('state-badge', 'blocked');
    expect(cssRule('.state-badge.blocked')).toContain('background: var(--color-danger-background);');
    expect(cssRule('.state-badge.blocked')).toContain('border: 1px solid var(--color-danger-border);');
    expect(cssRule('.state-badge.blocked')).toContain('color: var(--color-danger);');
  });

  it('styles needs feedback status badges with the amber color tokens', () => {
    render(<StateBadge compact state="Needs Feedback" />);

    expect(screen.getByText('NEEDS FEEDBACK')).toHaveClass('state-badge', 'needs-feedback');
    expect(cssRule('.state-badge.needs-feedback')).toContain('background: var(--state-amber-surface);');
    expect(cssRule('.state-badge.needs-feedback')).toContain('border: 1px solid var(--state-amber-600);');
    expect(cssRule('.state-badge.needs-feedback')).toContain('color: var(--state-amber-700);');
  });

  it('matches task header state badge typography to the adjacent todo id', () => {
    expect(cssRule('.copy-id')).toContain("font: 600 12px/16px 'JetBrains Mono', monospace;");
    expect(cssRule('.copy-id')).toContain('flex: 0 0 auto;');
    expect(cssRule('.copy-id')).toContain('white-space: nowrap;');
    expect(cssRule('.detail-id-row .state-badge')).toContain('align-self: center;');
    expect(cssRule('.detail-id-row .state-badge')).toContain('font-size: 12px;');
    expect(cssRule('.detail-id-row .state-badge')).toContain('line-height: 16px;');
  });

  it('animates task header buttons with the shared pressed state', () => {
    const pressableHeaderButtonClasses = [
      'copy-id',
      'state-badge-button',
      'context-badge-button',
    ];

    for (const buttonClass of pressableHeaderButtonClasses) {
      const pressedRules = cssRulesForSelector(`.${buttonClass}:not(:disabled):active`);

      expect(pressedRules, buttonClass).toContain('transform: translateY(1px) scale(0.98);');
      expect(pressedRules, buttonClass).toContain(
        'box-shadow: inset 0 2px 3px rgb(var(--color-shadow-rgb) / 24%);',
      );
      expect(appStyles, buttonClass).toMatch(
        new RegExp(`@media \\(prefers-reduced-motion: no-preference\\) \\{[\\s\\S]*\\.${buttonClass}`),
      );
    }
  });
});

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? '';
}

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
