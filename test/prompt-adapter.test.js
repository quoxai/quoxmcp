/**
 * PromptAdapter Tests
 */

import { describe, it, expect } from 'vitest';
import { registerPrompts, buildArgsShape, interpolateArgs } from '../lib/prompt-adapter.js';

// Helper: create a mock MCP server that captures registrations
function createMockServer() {
  const registered = [];
  return {
    registered,
    prompt(name, description, argsShape, handler) {
      registered.push({ name, description, argsShape, handler });
    }
  };
}

// Sample prompt definitions (mirrors collector API response)
const SAMPLE_PROMPTS = [
  {
    name: 'fleet-health',
    title: 'Fleet Health Check',
    description: 'Check infrastructure health',
    arguments: [
      { name: 'hosts', description: 'Comma-separated host filter', required: false }
    ],
    messages: [
      { role: 'user', text: 'Run a fleet health check{{#hosts}} on {{hosts}}{{/hosts}}{{^hosts}} across all hosts{{/hosts}}. Use fleet_status tool.' }
    ]
  },
  {
    name: 'deploy-check',
    title: 'Deployment Check',
    description: 'Check deployment health on a host',
    arguments: [
      { name: 'host', description: 'Target host', required: true },
      { name: 'service', description: 'Specific service', required: false }
    ],
    messages: [
      { role: 'user', text: 'Check deployment on {{host}}{{#service}} for {{service}}{{/service}}. Use docker_status tool.' }
    ]
  }
];

// ============================================================================
// buildArgsShape
// ============================================================================

describe('buildArgsShape', () => {
  it('creates shape with required string args', () => {
    const shape = buildArgsShape([{ name: 'host', description: 'Target', required: true }]);
    expect(shape).toHaveProperty('host');
    expect(shape.host.isOptional()).toBe(false);
  });

  it('creates shape with optional args', () => {
    const shape = buildArgsShape([{ name: 'scope', description: 'Scope', required: false }]);
    expect(shape).toHaveProperty('scope');
    expect(shape.scope.isOptional()).toBe(true);
  });

  it('handles empty arguments', () => {
    const shape = buildArgsShape([]);
    expect(Object.keys(shape)).toHaveLength(0);
  });

  it('handles multiple arguments', () => {
    const shape = buildArgsShape([
      { name: 'host', description: 'Host', required: true },
      { name: 'service', description: 'Service', required: false }
    ]);
    expect(Object.keys(shape)).toHaveLength(2);
    expect(shape.host.isOptional()).toBe(false);
    expect(shape.service.isOptional()).toBe(true);
  });
});

// ============================================================================
// interpolateArgs
// ============================================================================

describe('interpolateArgs', () => {
  it('substitutes simple variables', () => {
    const result = interpolateArgs('Hello {{name}}!', { name: 'world' });
    expect(result).toBe('Hello world!');
  });

  it('handles missing variables as empty string', () => {
    const result = interpolateArgs('Hello {{name}}!', {});
    expect(result).toBe('Hello !');
  });

  it('handles conditional blocks (present)', () => {
    const result = interpolateArgs('Check{{#hosts}} on {{hosts}}{{/hosts}}.', { hosts: 'docker01' });
    expect(result).toBe('Check on docker01.');
  });

  it('handles conditional blocks (absent)', () => {
    const result = interpolateArgs('Check{{#hosts}} on {{hosts}}{{/hosts}}.', {});
    expect(result).toBe('Check.');
  });

  it('handles inverse blocks (present)', () => {
    const result = interpolateArgs('{{^hosts}}all hosts{{/hosts}}', { hosts: 'docker01' });
    expect(result).toBe('');
  });

  it('handles inverse blocks (absent)', () => {
    const result = interpolateArgs('{{^hosts}}all hosts{{/hosts}}', {});
    expect(result).toBe('all hosts');
  });

  it('handles default values', () => {
    const result = interpolateArgs('Scope: {{scope|all}}', {});
    expect(result).toBe('Scope: all');
  });

  it('uses provided value over default', () => {
    const result = interpolateArgs('Scope: {{scope|all}}', { scope: 'network' });
    expect(result).toBe('Scope: network');
  });

  it('handles combined conditional and inverse blocks', () => {
    const template = '{{#hosts}}Hosts: {{hosts}}{{/hosts}}{{^hosts}}All infrastructure{{/hosts}}';
    expect(interpolateArgs(template, { hosts: 'docker01' })).toBe('Hosts: docker01');
    expect(interpolateArgs(template, {})).toBe('All infrastructure');
  });

  it('handles the fleet-health prompt template', () => {
    const template = 'Run a fleet health check{{#hosts}} focusing on hosts: {{hosts}}{{/hosts}}{{^hosts}} across all managed infrastructure{{/hosts}}.';
    const withHosts = interpolateArgs(template, { hosts: 'docker01,docker02' });
    expect(withHosts).toContain('docker01,docker02');
    expect(withHosts).not.toContain('all managed');

    const withoutHosts = interpolateArgs(template, {});
    expect(withoutHosts).toContain('all managed infrastructure');
  });
});

// ============================================================================
// registerPrompts
// ============================================================================

describe('registerPrompts', () => {
  it('registers all valid prompts', () => {
    const server = createMockServer();
    const count = registerPrompts(server, SAMPLE_PROMPTS);
    expect(count).toBe(2);
    expect(server.registered).toHaveLength(2);
  });

  it('returns 0 for empty array', () => {
    const server = createMockServer();
    const count = registerPrompts(server, []);
    expect(count).toBe(0);
  });

  it('skips prompts without name', () => {
    const server = createMockServer();
    const count = registerPrompts(server, [
      { description: 'No name prompt', messages: [] },
      { name: 'valid', description: 'Valid', messages: [] }
    ]);
    expect(count).toBe(1);
  });

  it('passes correct name and description', () => {
    const server = createMockServer();
    registerPrompts(server, [SAMPLE_PROMPTS[0]]);
    const reg = server.registered[0];
    expect(reg.name).toBe('fleet-health');
    expect(reg.description).toBe('Check infrastructure health');
  });

  it('builds argument shapes correctly', () => {
    const server = createMockServer();
    registerPrompts(server, [SAMPLE_PROMPTS[1]]);
    const reg = server.registered[0];
    expect(reg.argsShape).toHaveProperty('host');
    expect(reg.argsShape).toHaveProperty('service');
  });

  it('handler returns interpolated messages', async () => {
    const server = createMockServer();
    registerPrompts(server, [SAMPLE_PROMPTS[0]]);
    const handler = server.registered[0].handler;

    const result = await handler({ hosts: 'docker01,pve01' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.type).toBe('text');
    expect(result.messages[0].content.text).toContain('docker01,pve01');
  });

  it('handler handles missing optional args', async () => {
    const server = createMockServer();
    registerPrompts(server, [SAMPLE_PROMPTS[0]]);
    const handler = server.registered[0].handler;

    const result = await handler({});
    expect(result.messages[0].content.text).toContain('across all');
    expect(result.messages[0].content.text).not.toContain('{{');
  });

  it('handler interpolates required args', async () => {
    const server = createMockServer();
    registerPrompts(server, [SAMPLE_PROMPTS[1]]);
    const handler = server.registered[0].handler;

    const result = await handler({ host: 'docker01', service: 'nginx' });
    expect(result.messages[0].content.text).toContain('docker01');
    expect(result.messages[0].content.text).toContain('nginx');
  });

  it('handles prompts with no arguments', () => {
    const server = createMockServer();
    registerPrompts(server, [{
      name: 'simple',
      description: 'No args',
      arguments: [],
      messages: [{ role: 'user', text: 'Do something.' }]
    }]);
    expect(server.registered).toHaveLength(1);
    expect(Object.keys(server.registered[0].argsShape)).toHaveLength(0);
  });
});
