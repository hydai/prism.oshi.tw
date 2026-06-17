import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type WorkflowLine = {
  indent: number;
  text: string;
  trimmed: string;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(resolve(repoRoot, '.github/workflows/deploy.yml'), 'utf8');
const lines: WorkflowLine[] = workflow.split(/\r?\n/).map((text) => ({
  indent: text.length - text.trimStart().length,
  text,
  trimmed: text.trim(),
}));

function getBlock(parent: WorkflowLine[], key: string): WorkflowLine[] {
  const index = parent.findIndex((line) => line.trimmed === `${key}:`);
  assert.notEqual(index, -1, `missing ${key}: block`);

  const start = index + 1;
  const keyIndent = parent[index].indent;
  let end = parent.length;

  for (let i = start; i < parent.length; i += 1) {
    const line = parent[i];
    if (line.trimmed !== '' && line.indent <= keyIndent) {
      end = i;
      break;
    }
  }

  return parent.slice(start, end);
}

function tryGetBlock(parent: WorkflowLine[], key: string): WorkflowLine[] | undefined {
  const index = parent.findIndex((line) => line.trimmed === `${key}:`);
  if (index === -1) {
    return undefined;
  }

  return getBlock(parent, key);
}

function getPathBlock(path: string[]): WorkflowLine[] {
  return path.reduce((block, key) => getBlock(block, key), lines);
}

function readScalarMap(block: WorkflowLine[]): Record<string, string> {
  const entries: Record<string, string> = {};
  const childLines = block.filter((line) => line.trimmed !== '');
  const childIndent = Math.min(...childLines.map((line) => line.indent));

  for (const line of childLines) {
    if (line.indent !== childIndent) {
      continue;
    }

    const match = line.trimmed.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) {
      entries[match[1]] = match[2];
    }
  }

  return entries;
}

function assertPermissions(
  actual: Record<string, string>,
  expected: Record<string, string>,
  context: string,
): void {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${context} permission keys`);

  for (const key of Object.keys(expected)) {
    assert.equal(actual[key], expected[key], `${context} ${key} permission`);
  }
}

const workflowPermissions = readScalarMap(getPathBlock(['permissions']));
assertPermissions(workflowPermissions, { contents: 'read' }, 'workflow');

const jobs = getPathBlock(['jobs']);
const build = getBlock(jobs, 'build');
const buildPermissions = tryGetBlock(build, 'permissions');
assert.equal(buildPermissions, undefined, 'build job should inherit only workflow-level read permissions');

const buildText = build.map((line) => line.text).join('\n');
assert.match(buildText, /uses: actions\/checkout@v\d+/);
assert.match(buildText, /persist-credentials: false/);
assert.doesNotMatch(buildText, /pages:\s*write/);
assert.doesNotMatch(buildText, /id-token:\s*write/);
assert.doesNotMatch(buildText, /actions\/deploy-pages@v\d+/);

const deploy = getBlock(jobs, 'deploy');
const deployPermissions = readScalarMap(getBlock(deploy, 'permissions'));
assertPermissions(deployPermissions, {
  contents: 'read',
  pages: 'write',
  'id-token': 'write',
}, 'deploy');

const deployText = deploy.map((line) => line.text).join('\n');
assert.match(deployText, /actions\/deploy-pages@v\d+/);

console.log('deploy workflow permissions ok');
