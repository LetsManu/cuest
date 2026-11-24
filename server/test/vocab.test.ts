import { describe, expect, it } from 'vitest';
import { classifyAppliance, normalizeState } from '../src/domain/vocab.js';

describe('vocab', () => {
  it('normalizes', () => {
    expect(normalizeState('  Program Ended ')).toBe('program_ended');
    expect(normalizeState('Delayed-Start')).toBe('delayed_start');
    expect(normalizeState('Läuft')).toBe('läuft');
  });
  it('classifies', () => {
    expect(classifyAppliance('Dishwasher')).toBe('dishwasher');
    expect(classifyAppliance('Geschirrspüler Küche')).toBe('dishwasher');
    expect(classifyAppliance('Tumble Dryer')).toBe('dryer');
    expect(classifyAppliance('Trockner')).toBe('dryer');
    expect(classifyAppliance('Washer Dryer')).toBe('washer');
    expect(classifyAppliance('Waschmaschine Keller')).toBe('washer');
    expect(classifyAppliance('Living room light')).toBeNull();
  });
});
