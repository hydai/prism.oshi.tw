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

function getStepBlock(parent: WorkflowLine[], usesPattern: RegExp): WorkflowLine[] {
  const stepStarts = parent
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => line.trimmed.startsWith('- '));

  for (const { index, line: stepStart } of stepStarts) {
    let end = parent.length;

    for (let i = index + 1; i < parent.length; i += 1) {
      const line = parent[i];
      if (line.trimmed !== '' && line.indent <= stepStart.indent) {
        end = i;
        break;
      }
    }

    const block = parent.slice(index, end);
    if (block.some((line) => usesPattern.test(line.trimmed))) {
      return block;
    }
  }

  assert.fail(`missing step using ${usesPattern}`);
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
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    `${context} permission keys`,
  );

  for (const key of Object.keys(expected)) {
    assert.equal(actual[key], expected[key], `${context} ${key} permission`);
  }
}

const workflowPermissions = readScalarMap(getPathBlock(['permissions']));
assertPermissions(workflowPermissions, { contents: 'read' }, 'workflow');

const jobs = getPathBlock(['jobs']);
const build = getBlock(jobs, 'build');
const buildPermissions = tryGetBlock(build, 'permissions');
assertPermissions(
  buildPermissions === undefined ? workflowPermissions : readScalarMap(buildPermissions),
  { contents: 'read' },
  'build',
);

const buildText = build.map((line) => line.text).join('\n');
assert.doesNotMatch(buildText, /actions\/deploy-pages@/);

const checkoutStep = getStepBlock(getBlock(build, 'steps'), /^(?:- )?uses: actions\/checkout@/);
assert.equal(
  readScalarMap(getBlock(checkoutStep, 'with'))['persist-credentials'],
  'false',
  'build checkout should not persist credentials',
);

const deploy = getBlock(jobs, 'deploy');
const deployPermissions = readScalarMap(getBlock(deploy, 'permissions'));
assertPermissions(deployPermissions, {
  contents: 'read',
  pages: 'write',
  'id-token': 'write',
}, 'deploy');

const deployText = deploy.map((line) => line.text).join('\n');
assert.match(deployText, /actions\/deploy-pages@/);

console.log('deploy workflow permissions ok');
