const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readdirSync, readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : [];
  });
}

test('project guides have resolvable repository-relative links', () => {
  const files = ['README.md', 'AGENTS.md', 'specs.md'].map(file => path.join(root, file));
  files.push(...markdownFiles(path.join(root, 'docs')));
  let checked = 0;
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const link = match[1].trim().replace(/^<|>$/g, '');
      if (/^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith('#')) continue;
      const target = path.resolve(path.dirname(file), decodeURIComponent(link.split('#')[0]));
      const relative = path.relative(root, target);
      assert.ok(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`),
        `Link leaves the repository in ${path.relative(root, file)}: ${link}`);
      assert.ok(existsSync(target), `Broken link in ${path.relative(root, file)}: ${link}`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'No local documentation links were checked');
});
