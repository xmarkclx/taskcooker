import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const releaseConfig = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.release.conf.json', import.meta.url), 'utf8'),
);

test('dev:prod-db starts Tauri dev with the production identity override', () => {
  assert.equal(
    packageJson.scripts['dev:prod-db'],
    'tauri dev --config src-tauri/tauri.release.conf.json',
  );
  assert.equal(releaseConfig.productName, 'TaskCooker');
  assert.equal(releaseConfig.identifier, 'com.marklopez.boomerangtasks');
});
