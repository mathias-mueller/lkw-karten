import { describe, it, expect } from 'vitest';
import { parseOsmValue, buildOverpassQuery, evaluateStatus } from './osmService';
import type { TruckConfig } from './types';

describe('osmService', () => {
  describe('parseOsmValue', () => {
    it('returns undefined for empty or falsy values', () => {
      expect(parseOsmValue(undefined)).toBeUndefined();
      expect(parseOsmValue('')).toBeUndefined();
    });

    it('returns undefined for non-numerical keywords', () => {
      expect(parseOsmValue('none')).toBeUndefined();
      expect(parseOsmValue('default')).toBeUndefined();
      expect(parseOsmValue('unsigned')).toBeUndefined();
    });

    it('parses metric values with units and commas', () => {
      expect(parseOsmValue('3.8')).toBe(3.8);
      expect(parseOsmValue('3.8m')).toBe(3.8);
      expect(parseOsmValue('3,8 m')).toBe(3.8);
      expect(parseOsmValue('12t')).toBe(12);
      expect(parseOsmValue('12.5 tonnes')).toBe(12.5);
    });

    it('parses imperial feet and inches correctly', () => {
      // 13'6" -> 13 * 0.3048 + 6 * 0.0254 = 3.9624 + 0.1524 = 4.1148 -> 4.11
      const val = parseOsmValue("13'6\"");
      expect(val).toBeCloseTo(4.11, 2);
    });
  });

  describe('buildOverpassQuery', () => {
    it('generates query string containing coordinates', () => {
      const query = buildOverpassQuery(50.0, 8.0, 50.5, 8.5);
      expect(query).toContain('50,8,50.5,8.5');
      expect(query).toContain('maxheight');
      expect(query).toContain('maxwidth');
      expect(query).toContain('maxweight');
    });
  });

  describe('evaluateStatus', () => {
    const truck: TruckConfig = {
      height: 4.0,
      width: 2.55,
      weight: 40.0,
      axleLoad: 11.5,
    };

    it('flags red when restriction limit is lower than truck dimensions', () => {
      const result = evaluateStatus(truck, { maxHeight: 3.8 });
      expect(result.status).toBe('red');
      expect(result.failedTypes).toContain('height');
    });

    it('flags yellow when close to limit', () => {
      // 4.0 vs 4.1: within 0.15m margin
      const result = evaluateStatus(truck, { maxHeight: 4.1 });
      expect(result.status).toBe('yellow');
      expect(result.borderlineTypes).toContain('height');
    });

    it('flags green when safely below limit', () => {
      const result = evaluateStatus(truck, { maxHeight: 4.5, maxWeight: 50 });
      expect(result.status).toBe('green');
      expect(result.failedTypes.length).toBe(0);
      expect(result.borderlineTypes.length).toBe(0);
    });
  });
});
