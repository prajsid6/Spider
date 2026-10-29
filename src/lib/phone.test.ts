import { describe, expect, it } from 'vitest';
import { normalizePhoneNumber } from './phone';

describe('normalizePhoneNumber', () => {
  it('adds the India country code to a 10-digit mobile number', () => {
    expect(normalizePhoneNumber('98765 43210')).toBe('+919876543210');
  });

  it('preserves a valid international number and strips formatting', () => {
    expect(normalizePhoneNumber('+1 (415) 555-2671')).toBe('+14155552671');
  });

  it('rejects invalid numbers', () => {
    expect(() => normalizePhoneNumber('12345')).toThrow('valid phone number');
  });
});
