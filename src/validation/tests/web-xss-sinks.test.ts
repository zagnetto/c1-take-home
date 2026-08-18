import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const appJs = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../web/app.js'),
  'utf8',
);

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const braceStart = source.indexOf('{', start);
  assert.notEqual(braceStart, -1, `missing body for ${name}`);

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

test('renderSidebar does not interpolate conversation titles into innerHTML', () => {
  const renderSidebar = extractFunction(appJs, 'renderSidebar');
  assert.doesNotMatch(renderSidebar, /innerHTML\s*=\s*[`'"][^`'"]*\$\{/);
  assert.match(renderSidebar, /textContent/);
  assert.match(renderSidebar, /c\.title/);
});

test('user-controlled fields are not assigned to innerHTML in web/app.js', () => {
  const userFields = ['c.title', 'r.conversationTitle', 'm.body', 'userName', 'q'];
  for (const field of userFields) {
    const pattern = new RegExp(`innerHTML\\s*=\\s*\`[^\`]*\\$\\{[^}]*${field.replace('.', '\\.')}`);
    assert.doesNotMatch(appJs, pattern, `${field} must not appear in an innerHTML template literal`);
  }
});
