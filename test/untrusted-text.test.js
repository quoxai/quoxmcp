/**
 * VULCAN FND_01M6V4CK6EC9EJ0RKPMB5GQ3DN (MCP-04): collector-provided strings (tool descriptions,
 * input schemas, resource metadata/content, prompt text) reach the MCP client's model context.
 * They must be stripped of control/invisible/bidi characters, length-capped, and oversized or
 * over-deep schemas must be refused, without inventing any text that alters tool semantics.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeUntrustedText,
  schemaTooComplex,
  MAX_DESCRIPTION_LENGTH,
  MAX_PROMPT_TEXT_LENGTH,
  MAX_SCHEMA_BYTES,
  MAX_SCHEMA_DEPTH
} from '../lib/validate.js';
import { registerTools, jsonSchemaToZodShape } from '../lib/tool-adapter.js';
import { registerResources } from '../lib/resource-adapter.js';
import { registerPrompts } from '../lib/prompt-adapter.js';

const INVISIBLES = [
  '​', '‌', '‍', '‎', '‏',
  '‪', '‫', '‬', '‭', '‮',
  '⁦', '⁧', '⁨', '⁩',
  '⁠', '﻿'
];

describe('sanitizeUntrustedText', () => {
  it('documents the caps as constants', () => {
    expect(MAX_DESCRIPTION_LENGTH).toBe(2000);
    expect(MAX_PROMPT_TEXT_LENGTH).toBeGreaterThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(MAX_SCHEMA_BYTES).toBeGreaterThan(0);
    expect(MAX_SCHEMA_DEPTH).toBeGreaterThan(0);
  });

  it.each(INVISIBLES.map((c) => [c.codePointAt(0).toString(16)]))('strips U+%s', (hex) => {
    const ch = String.fromCodePoint(parseInt(hex, 16));
    expect(sanitizeUntrustedText(`run${ch}fleet`, 100)).toBe('runfleet');
  });

  it('strips C0 controls (except newline and tab), DEL and C1 controls', () => {
    const s = 'a\u0000b\u0007c\u001Bd\u007Fe\u0085f\u009Bg';
    expect(sanitizeUntrustedText(s, 100)).toBe('abcdefg');
  });

  it('keeps newline and tab, normalises CRLF to LF', () => {
    expect(sanitizeUntrustedText('line1\r\nline2\tcol', 100)).toBe('line1\nline2\tcol');
  });

  it('strips Unicode tag characters (ASCII smuggling, U+E0000-U+E007F)', () => {
    const hidden = Array.from('ignore').map((c) => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('');
    expect(sanitizeUntrustedText(`ok${hidden}`, 100)).toBe('ok');
  });

  it('keeps ordinary non-ASCII text intact', () => {
    expect(sanitizeUntrustedText('Café ✔ 日本 🚀', 100)).toBe('Café ✔ 日本 🚀');
  });

  it('caps length and marks the truncation, never exceeding the cap', () => {
    const out = sanitizeUntrustedText('x'.repeat(5000), 2000);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.endsWith('[truncated]')).toBe(true);
  });

  it('does not split a surrogate pair when truncating', () => {
    const out = sanitizeUntrustedText('🚀'.repeat(3000), 2000);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(out.length).toBeLessThanOrEqual(2000);
  });

  it('returns empty string for non-strings', () => {
    expect(sanitizeUntrustedText(undefined, 10)).toBe('');
    expect(sanitizeUntrustedText(null, 10)).toBe('');
    expect(sanitizeUntrustedText({}, 10)).toBe('');
  });
});

describe('schemaTooComplex', () => {
  it('accepts a normal schema', () => {
    expect(schemaTooComplex({ type: 'object', properties: { host: { type: 'string' } } })).toBe(false);
    expect(schemaTooComplex(undefined)).toBe(false);
  });

  it('rejects a schema over the byte cap', () => {
    const properties = {};
    for (let i = 0; i < 5000; i++) properties[`p${i}`] = { type: 'string', description: 'x'.repeat(20) };
    expect(JSON.stringify({ properties }).length).toBeGreaterThan(MAX_SCHEMA_BYTES);
    expect(schemaTooComplex({ properties })).toBe(true);
  });

  it('rejects a schema nested deeper than the depth cap', () => {
    let node = { type: 'string' };
    for (let i = 0; i < MAX_SCHEMA_DEPTH + 2; i++) node = { type: 'object', properties: { n: node } };
    expect(schemaTooComplex(node)).toBe(true);
  });

  it('rejects a cyclic / unserialisable schema', () => {
    const a = { type: 'object', properties: {} };
    a.properties.self = a;
    expect(schemaTooComplex(a)).toBe(true);
  });
});

describe('registerTools: untrusted text hardening', () => {
  function capture() {
    const registered = [];
    return { registered, server: { tool: (name, desc, shape, handler) => registered.push({ name, desc, shape }) } };
  }

  it('strips invisible/bidi characters from the tool description', () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerTools(server, [
      { name: 't1', description: 'List​ hosts‮ evil⁦', input_schema: { properties: {} } }
    ], {}, { agentId: 'quox' });
    console.error.mockRestore();
    expect(registered[0].desc).toBe('List hosts evil');
  });

  it('caps the tool description at MAX_DESCRIPTION_LENGTH', () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerTools(server, [{ name: 't1', description: 'a'.repeat(10000), input_schema: { properties: {} } }], {}, { agentId: 'quox' });
    console.error.mockRestore();
    expect(registered[0].desc.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it('does not prefix or wrap descriptions with invented text', () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerTools(server, [{ name: 't1', description: 'Get fleet status', input_schema: { properties: {} } }], {}, { agentId: 'quox' });
    console.error.mockRestore();
    expect(registered[0].desc).toBe('Get fleet status');
  });

  it('skips a tool whose description is only invisible characters', () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const n = registerTools(server, [{ name: 't1', description: '​​', input_schema: { properties: {} } }], {}, { agentId: 'quox' });
    console.error.mockRestore();
    expect(n).toBe(0);
    expect(registered).toHaveLength(0);
  });

  it('skips a tool whose input schema is over the size cap', () => {
    const { registered, server } = capture();
    const properties = {};
    for (let i = 0; i < 5000; i++) properties[`p${i}`] = { type: 'string', description: 'x'.repeat(20) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const n = registerTools(server, [
      { name: 'huge', description: 'Huge', input_schema: { properties } },
      { name: 'ok', description: 'Ok', input_schema: { properties: {} } }
    ], {}, { agentId: 'quox' });
    console.error.mockRestore();
    expect(n).toBe(1);
    expect(registered.map((r) => r.name)).toEqual(['ok']);
  });

  it('skips a tool whose input schema is nested too deep', () => {
    const { registered, server } = capture();
    let node = { type: 'string' };
    for (let i = 0; i < MAX_SCHEMA_DEPTH + 2; i++) node = { type: 'object', properties: { n: node } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const n = registerTools(server, [{ name: 'deep', description: 'Deep', input_schema: node }], {}, { agentId: 'quox' });
    console.error.mockRestore();
    expect(n).toBe(0);
    expect(registered).toHaveLength(0);
  });

  it('skips a tool whose schema has a property name carrying control/invisible characters', () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const n = registerTools(server, [
      { name: 'sneaky', description: 'Sneaky', input_schema: { properties: { 'host‮': { type: 'string' } } } }
    ], {}, { agentId: 'quox' });
    console.error.mockRestore();
    expect(n).toBe(0);
    expect(registered).toHaveLength(0);
  });

  it('sanitises and caps property descriptions in the schema', () => {
    const shape = jsonSchemaToZodShape({
      host: { type: 'string', description: 'Target​ host\u0007' },
      big: { type: 'string', description: 'b'.repeat(9000) }
    }, ['host']);
    expect(shape.host.description).toBe('Target host');
    expect(shape.big.unwrap().description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });
});

describe('registerResources: untrusted text hardening', () => {
  function capture() {
    const registered = [];
    return { registered, server: { resource: (name, uri, metadata, handler) => registered.push({ name, uri, metadata, handler }) } };
  }

  it('sanitises and caps title and description', () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerResources(server, [{
      name: 'r1', uri: 'quox://r/1', title: 'Ti‮tle', description: 'd​'.repeat(5000), content: 'x'
    }]);
    console.error.mockRestore();
    expect(registered[0].metadata.title).toBe('Title');
    expect(registered[0].metadata.description).not.toMatch(/​/);
    expect(registered[0].metadata.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it('strips invisible characters from static content', async () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerResources(server, [{ name: 'r1', uri: 'quox://r/1', content: 'hel⁦lo\u0000' }]);
    console.error.mockRestore();
    const out = await registered[0].handler('quox://r/1');
    expect(out.contents[0].text).toBe('hello');
  });

  it('strips invisible characters from live-fetched content', async () => {
    const { registered, server } = capture();
    const client = { listResources: vi.fn().mockResolvedValue({ resources: [{ name: 'live-mcp04', content: 'fr‏esh' }] }) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerResources(server, [{ name: 'live-mcp04', uri: 'quox://r/live', live: true, content: '' }], client);
    console.error.mockRestore();
    const out = await registered[0].handler('quox://r/live');
    expect(out.contents[0].text).toBe('fresh');
  });
});

describe('registerPrompts: untrusted text hardening', () => {
  function capture() {
    const registered = [];
    return { registered, server: { prompt: (name, description, argsShape, handler) => registered.push({ name, description, argsShape, handler }) } };
  }

  it('sanitises and caps the prompt description', () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerPrompts(server, [{ name: 'p1', description: 'Che​ck'.repeat(1000), messages: [] }]);
    console.error.mockRestore();
    expect(registered[0].description).not.toMatch(/​/);
    expect(registered[0].description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it('sanitises argument descriptions', () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerPrompts(server, [{ name: 'p1', description: 'd', arguments: [{ name: 'host', description: 'Ta‮rgct', required: true }], messages: [] }]);
    console.error.mockRestore();
    expect(registered[0].argsShape.host.description).toBe('Targct');
  });

  it('sanitises and caps message text', async () => {
    const { registered, server } = capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerPrompts(server, [{
      name: 'p1', description: 'd',
      messages: [
        { role: 'user', text: 'Run⁧ check on {{host}}\u0000' },
        { role: 'user', text: 'z'.repeat(MAX_PROMPT_TEXT_LENGTH * 2) }
      ]
    }]);
    console.error.mockRestore();
    const out = await registered[0].handler({ host: 'docker01' });
    expect(out.messages[0].content.text).toBe('Run check on docker01');
    expect(out.messages[1].content.text.length).toBeLessThanOrEqual(MAX_PROMPT_TEXT_LENGTH);
  });
});
