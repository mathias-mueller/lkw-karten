import { describe, it, expect } from 'vitest';
import { isBayernArea, lon2tile, lat2tile, BAYERN_BBOX } from './pmtilesService';
import type { LatLngBounds } from 'leaflet';

describe('pmtilesService', () => {
  describe('tile math', () => {
    it('calculates lon2tile and lat2tile correctly', () => {
      // (0, 0) at zoom 0 is tile (0, 0)
      expect(lon2tile(0, 0)).toBe(0);
      expect(lat2tile(0, 0)).toBe(0);

      // Munich [48.137, 11.576] at zoom 14 -> x=8718, y=5685
      const x = lon2tile(11.576, 14);
      const y = lat2tile(48.137, 14);
      expect(x).toBe(8718);
      expect(y).toBe(5685);
    });
  });

  describe('isBayernArea', () => {
    it('identifies areas within Bayern correctly', () => {
      // Munich bounds
      const munichBounds = {
        getSouth: () => 48.1,
        getNorth: () => 48.2,
        getWest: () => 11.5,
        getEast: () => 11.6,
      } as unknown as LatLngBounds;
      expect(isBayernArea(munichBounds)).toBe(true);

      // Nuremberg bounds
      const nurembergBounds = {
        getSouth: () => 49.4,
        getNorth: () => 49.5,
        getWest: () => 11.0,
        getEast: () => 11.1,
      } as unknown as LatLngBounds;
      expect(isBayernArea(nurembergBounds)).toBe(true);
    });

    it('identifies areas outside Bayern correctly', () => {
      // Berlin
      const berlinBounds = {
        getSouth: () => 52.4,
        getNorth: () => 52.6,
        getWest: () => 13.3,
        getEast: () => 13.5,
      } as unknown as LatLngBounds;
      expect(isBayernArea(berlinBounds)).toBe(false);

      // Paris
      const parisBounds = {
        getSouth: () => 48.8,
        getNorth: () => 48.9,
        getWest: () => 2.3,
        getEast: () => 2.4,
      } as unknown as LatLngBounds;
      expect(isBayernArea(parisBounds)).toBe(false);
    });

    it('has valid BAYERN_BBOX coordinates', () => {
      expect(BAYERN_BBOX.minLon).toBeLessThan(BAYERN_BBOX.maxLon);
      expect(BAYERN_BBOX.minLat).toBeLessThan(BAYERN_BBOX.maxLat);
    });
  });
});
