import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseOsmValue,
  buildOverpassQuery,
  evaluateStatus,
  OsmApiError,
  getErrorMessage,
  fetchOsmRestrictions,
} from './osmService';
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
    it('generates query string containing coordinates and qt sorting', () => {
      const query = buildOverpassQuery(50.0, 8.0, 50.5, 8.5);
      expect(query).toContain('50,8,50.5,8.5');
      expect(query).toContain('maxheight');
      expect(query).toContain('maxwidth');
      expect(query).toContain('maxweight');
      expect(query).toContain('out center tags qt;');
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

  describe('OsmApiError & getErrorMessage', () => {
    it('creates an OsmApiError instance with correct properties', () => {
      const err = new OsmApiError('User friendly message', 429, 'Raw error');
      expect(err.name).toBe('OsmApiError');
      expect(err.userMessage).toBe('User friendly message');
      expect(err.statusCode).toBe(429);
      expect(err.message).toBe('User friendly message');
      expect(err.rawMessage).toBe('Raw error');
    });

    it('returns OsmApiError userMessage when passed to getErrorMessage', () => {
      const err = new OsmApiError('Zu viele Anfragen', 429);
      expect(getErrorMessage(err)).toBe('Zu viele Anfragen');
    });

    it('returns connection error message on fetch TypeError', () => {
      const typeError = new TypeError('Failed to fetch');
      const msg = getErrorMessage(typeError);
      expect(msg).toContain('Verbindung zum OSM Overpass-Server fehlgeschlagen');
    });

    it('returns zoom warning when currentZoom is below 11', () => {
      const msg = getErrorMessage(new Error(''), 10);
      expect(msg).toContain('Zoomstufe 10');
      expect(msg).toContain('mindestens Stufe 11');
    });
  });

  describe('fetchOsmRestrictions error scenarios', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('throws OsmApiError with 429 on rate limit', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(fetchOsmRestrictions(50, 8, 51, 9)).rejects.toThrow(OsmApiError);
      await expect(fetchOsmRestrictions(50, 8, 51, 9)).rejects.toThrow(/Rate Limit/);
    });

    it('throws OsmApiError on 504 gateway timeout', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 504,
        statusText: 'Gateway Timeout',
      });

      await expect(fetchOsmRestrictions(50, 8, 51, 9)).rejects.toThrow(OsmApiError);
      await expect(fetchOsmRestrictions(50, 8, 51, 9)).rejects.toThrow(/Zeitüberschreitung/);
    });

    it('throws OsmApiError when response JSON contains timeout remark', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: 0.6,
          remark: 'runtime error: Query timed out in "query" at line 3 after 25 seconds.',
          elements: [],
        }),
      });

      await expect(fetchOsmRestrictions(50, 8, 51, 9)).rejects.toThrow(/Zeitüberschreitung/);
    });

    it('returns elements array on successful response', async () => {
      const mockElements = [
        { type: 'node', id: 12345, lat: 50.1, lon: 8.6, tags: { maxheight: '3.8' } },
      ];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: 0.6,
          elements: mockElements,
        }),
      });

      const res = await fetchOsmRestrictions(50, 8, 51, 9);
      expect(res).toEqual(mockElements);
    });
  });
});
