/**
 * VULCAN FND_01M6V4CS54E2X4Q7TRVZEH24P4 (MCP-11/12): supply chain hygiene.
 * The MCP SDK is pinned to the exact locked version, package.json and package-lock.json agree,
 * CI runs the suite, and the deployment tarball is a build output, never a tracked file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

describe('dependency pinning and lockfile agreement', () => {
  it('pins @modelcontextprotocol/sdk to the exact version in package-lock.json', () => {
    const range = pkg.dependencies['@modelcontextprotocol/sdk'];
    const locked = lock.packages['node_modules/@modelcontextprotocol/sdk'].version;
    expect(range).toMatch(/^\d+\.\d+\.\d+$/);
    expect(range).toBe(locked);
  });

  it('package-lock.json root matches package.json (name, version, deps)', () => {
    const lockRoot = lock.packages[''];
    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(lockRoot.version).toBe(pkg.version);
    expect(lockRoot.dependencies).toEqual(pkg.dependencies);
    expect(lockRoot.devDependencies).toEqual(pkg.devDependencies);
  });
});

describe('CI', () => {
  const wf = path.join(root, '.github', 'workflows', 'test.yml');

  it('has a test workflow running npm ci and vitest on Node 20 and 22', () => {
    expect(existsSync(wf)).toBe(true);
    const y = readFileSync(wf, 'utf8');
    expect(y).toMatch(/npm ci/);
    expect(y).toMatch(/npx vitest run/);
    expect(y).toMatch(/\b20\b/);
    expect(y).toMatch(/\b22\b/);
  });

  it('pins every action to a commit SHA or a major tag', () => {
    const y = readFileSync(wf, 'utf8');
    const uses = [...y.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@([0-9a-f]{40}|v\d+)$/);
  });
});

describe('deployment bundle is a build output', () => {
  it('deploy/quoxmcp-bundle.tar.gz is not tracked by git', () => {
    const tracked = execFileSync('git', ['ls-files', 'deploy/'], { cwd: root, encoding: 'utf8' });
    expect(tracked).not.toMatch(/quoxmcp-bundle\.tar\.gz/);
  });

  it('.gitignore ignores the bundle', () => {
    const gi = readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gi).toMatch(/quoxmcp-bundle\.tar\.gz/);
  });
});

describe('one version everywhere', () => {
  it('manifest.json carries the package.json version (what Claude Desktop shows at install)', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(pkg.version);
  });

  it('server.js reports the package.json version to MCP clients, not a hardcoded literal', () => {
    const src = readFileSync(path.join(root, 'server.js'), 'utf8');
    expect(src).not.toMatch(/version:\s*['"]\d+\.\d+\.\d+['"]/);
    expect(src).toMatch(/require\(['"]\.\/package\.json['"]\)\.version/);
  });
});
