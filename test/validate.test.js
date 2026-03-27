import { describe, it, expect } from 'vitest'
import {
  isValidId,
  isValidToolName,
  validateUrl,
  isValidResourceUri,
  sanitizeError,
  escapeTemplateChars,
  inputTooLarge,
  SAFE_ID,
  SAFE_TOOL_NAME,
  MAX_INPUT_SIZE,
} from '../lib/validate'

describe('validate', () => {
  describe('isValidId', () => {
    it('accepts simple alphanumeric IDs', () => {
      expect(isValidId('quox')).toBe(true)
      expect(isValidId('sentinel')).toBe(true)
      expect(isValidId('agent123')).toBe(true)
    })

    it('accepts IDs with dashes and underscores', () => {
      expect(isValidId('my-agent')).toBe(true)
      expect(isValidId('my_agent')).toBe(true)
      expect(isValidId('a-b_c-123')).toBe(true)
    })

    it('rejects empty strings', () => {
      expect(isValidId('')).toBe(false)
    })

    it('rejects non-string inputs', () => {
      expect(isValidId(null)).toBe(false)
      expect(isValidId(undefined)).toBe(false)
      expect(isValidId(123)).toBe(false)
      expect(isValidId({})).toBe(false)
    })

    it('rejects IDs with special characters', () => {
      expect(isValidId('agent;DROP TABLE')).toBe(false)
      expect(isValidId('agent<script>')).toBe(false)
      expect(isValidId('../../../etc/passwd')).toBe(false)
      expect(isValidId('agent name')).toBe(false)
      expect(isValidId('agent\nid')).toBe(false)
    })

    it('rejects IDs longer than 64 characters', () => {
      expect(isValidId('a'.repeat(64))).toBe(true)
      expect(isValidId('a'.repeat(65))).toBe(false)
    })
  })

  describe('isValidToolName', () => {
    it('accepts valid tool names', () => {
      expect(isValidToolName('memory_save')).toBe(true)
      expect(isValidToolName('fleet.status')).toBe(true)
      expect(isValidToolName('host-check')).toBe(true)
    })

    it('rejects names with injection characters', () => {
      expect(isValidToolName('tool;rm -rf /')).toBe(false)
      expect(isValidToolName('tool$(cmd)')).toBe(false)
      expect(isValidToolName('tool`cmd`')).toBe(false)
    })

    it('rejects names longer than 128 characters', () => {
      expect(isValidToolName('a'.repeat(128))).toBe(true)
      expect(isValidToolName('a'.repeat(129))).toBe(false)
    })

    it('rejects non-string inputs', () => {
      expect(isValidToolName(null)).toBe(false)
      expect(isValidToolName(42)).toBe(false)
    })
  })

  describe('validateUrl', () => {
    it('accepts valid HTTP URLs', () => {
      const result = validateUrl('http://127.0.0.1:9848')
      expect(result.valid).toBe(true)
      expect(result.warning).toBeNull()
    })

    it('accepts valid HTTPS URLs', () => {
      const result = validateUrl('https://api.quox.ai:443')
      expect(result.valid).toBe(true)
      expect(result.warning).toBeNull()
    })

    it('warns about HTTP on public networks', () => {
      const result = validateUrl('http://203.0.113.5:8080')
      expect(result.valid).toBe(true)
      expect(result.warning).toContain('HTTP')
    })

    it('does not warn about HTTP on private networks', () => {
      expect(validateUrl('http://10.0.0.1:9848').warning).toBeNull()
      expect(validateUrl('http://192.168.1.1:9848').warning).toBeNull()
      expect(validateUrl('http://172.16.0.1:9848').warning).toBeNull()
      expect(validateUrl('http://localhost:9848').warning).toBeNull()
    })

    it('rejects non-HTTP protocols', () => {
      expect(validateUrl('ftp://server:21').valid).toBe(false)
      expect(validateUrl('file:///etc/passwd').valid).toBe(false)
      expect(validateUrl('javascript:alert(1)').valid).toBe(false)
    })

    it('rejects invalid URLs', () => {
      expect(validateUrl('not-a-url').valid).toBe(false)
      expect(validateUrl('').valid).toBe(false)
    })
  })

  describe('isValidResourceUri', () => {
    it('accepts quox:// URIs', () => {
      expect(isValidResourceUri('quox://agents/sentinel')).toBe(true)
      expect(isValidResourceUri('quox://memory/facts')).toBe(true)
    })

    it('accepts http/https URIs', () => {
      expect(isValidResourceUri('http://localhost:9848/health')).toBe(true)
      expect(isValidResourceUri('https://api.quox.ai/v1')).toBe(true)
    })

    it('rejects dangerous schemes', () => {
      expect(isValidResourceUri('file:///etc/passwd')).toBe(false)
      expect(isValidResourceUri('javascript:alert(1)')).toBe(false)
    })

    it('rejects non-string inputs', () => {
      expect(isValidResourceUri(null)).toBe(false)
      expect(isValidResourceUri(undefined)).toBe(false)
      expect(isValidResourceUri(123)).toBe(false)
    })
  })

  describe('sanitizeError', () => {
    it('strips private IP addresses', () => {
      const sanitized = sanitizeError('Connection refused to 10.0.0.101:9848')
      expect(sanitized).not.toContain('10.0.0.101')
      expect(sanitized).toContain('[internal-ip]')
    })

    it('strips 192.168.x.x addresses', () => {
      const sanitized = sanitizeError('Failed to connect to 192.168.88.247')
      expect(sanitized).not.toContain('192.168.88.247')
    })

    it('strips file paths', () => {
      const sanitized = sanitizeError('Error reading /home/control/quoxmcp/config.json')
      expect(sanitized).not.toContain('/home/control')
      expect(sanitized).toContain('[path]')
    })

    it('strips localhost URLs', () => {
      const sanitized = sanitizeError('Failed to fetch http://localhost:9848/tools')
      expect(sanitized).not.toContain('localhost:9848')
      expect(sanitized).toContain('[collector]')
    })

    it('strips numeric IP URLs', () => {
      const sanitized = sanitizeError('Error from http://10.0.0.126:9848/api')
      expect(sanitized).not.toContain('10.0.0.126')
    })

    it('handles non-string input', () => {
      expect(sanitizeError(null)).toBe('Unknown error')
      expect(sanitizeError(undefined)).toBe('Unknown error')
      expect(sanitizeError(42)).toBe('Unknown error')
    })

    it('preserves safe error messages', () => {
      expect(sanitizeError('Tool not found')).toBe('Tool not found')
      expect(sanitizeError('Invalid JSON')).toBe('Invalid JSON')
    })
  })

  describe('escapeTemplateChars', () => {
    it('escapes mustache-style template markers', () => {
      expect(escapeTemplateChars('Hello {{name}}')).toBe('Hello \\{\\{name\\}\\}')
    })

    it('passes through normal strings', () => {
      expect(escapeTemplateChars('no templates here')).toBe('no templates here')
    })

    it('handles non-string input', () => {
      expect(escapeTemplateChars(null)).toBe('')
      expect(escapeTemplateChars(undefined)).toBe('')
      expect(escapeTemplateChars(42)).toBe('42')
    })
  })

  describe('inputTooLarge', () => {
    it('returns false for small inputs', () => {
      expect(inputTooLarge({ key: 'value' })).toBe(false)
    })

    it('returns true for inputs exceeding 1MB', () => {
      const largeInput = { data: 'x'.repeat(MAX_INPUT_SIZE + 1) }
      expect(inputTooLarge(largeInput)).toBe(true)
    })

    it('returns true for circular references (non-serializable)', () => {
      const circular = {}
      circular.self = circular
      expect(inputTooLarge(circular)).toBe(true)
    })
  })
})
