import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('install app script', () => {
  it('defaults the installed app bundle name to TaskCooker', () => {
    const script = readFileSync(join(process.cwd(), 'scripts/install-app.sh'), 'utf8');

    expect(script).toContain('APP_NAME="${APP_NAME:-TaskCooker}"');
  });
});
