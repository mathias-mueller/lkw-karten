import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { OsmElement } from './types';
import type { LatLngBounds } from 'leaflet';

// Resolve URL for bayern.pmtiles considering Vite base URL
const getPmTilesUrl = () => {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${cleanBase}bayern.pmtiles`;
};

let pmTilesInstance: PMTiles | null = null;

export function getPmTilesInstance(): PMTiles {
  if (!pmTilesInstance) {
    pmTilesInstance = new PMTiles(getPmTilesUrl());
  }
  return pmTilesInstance;
}

// Bounding box for Bayern (Bavaria)
export const BAYERN_BBOX = {
  minLon: 9.01,
  minLat: 47.32,
  maxLon: 13.82,
  maxLat: 50.53,
};

/**
 * Checks if a given Leaflet bounds intersects or is located within Bayern.
 */
export function isBayernArea(bounds: LatLngBounds): boolean {
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  return (
    south <= BAYERN_BBOX.maxLat &&
    north >= BAYERN_BBOX.minLat &&
    west <= BAYERN_BBOX.maxLon &&
    east >= BAYERN_BBOX.minLon
  );
}

// Helpers for Lat/Lon <-> Tile X/Y calculations (Web Mercator)
export function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

export function lat2tile(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

/**
 * Fetches restriction points for the given bounding box directly from PMTiles vector tiles.
 * Execution time is typically < 20ms!
 */
export async function fetchRestrictionsFromPmTiles(
  bounds: LatLngBounds,
  zoom: number
): Promise<OsmElement[]> {
  const pmtiles = getPmTilesInstance();

  // Clamp tile query zoom to a high-density zoom level (13 to 15)
  const queryZoom = Math.min(15, Math.max(12, zoom));

  const south = Math.max(BAYERN_BBOX.minLat, bounds.getSouth());
  const north = Math.min(BAYERN_BBOX.maxLat, bounds.getNorth());
  const west = Math.max(BAYERN_BBOX.minLon, bounds.getWest());
  const east = Math.min(BAYERN_BBOX.maxLon, bounds.getEast());

  if (south >= north || west >= east) {
    return [];
  }

  const minX = lon2tile(west, queryZoom);
  const maxX = lon2tile(east, queryZoom);
  const minY = lat2tile(north, queryZoom);
  const maxY = lat2tile(south, queryZoom);

  const tilePromises: Promise<{ x: number; y: number; data?: ArrayBuffer } | null>[] = [];

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tilePromises.push(
        pmtiles
          .getZxy(queryZoom, x, y)
          .then((res) => (res && res.data ? { x, y, data: res.data } : null))
          .catch((err) => {
            console.warn(`PMTiles fetch error at ${queryZoom}/${x}/${y}:`, err);
            return null;
          })
      );
    }
  }

  const tiles = await Promise.all(tilePromises);
  const elementsMap = new Map<string, OsmElement>();

  for (const item of tiles) {
    if (!item || !item.data) continue;

    try {
      const pbf = new PbfReader(new Uint8Array(item.data));
      // Typecast through unknown to satisfy VectorTile constructor
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vt = new VectorTile(pbf as any);
      const layer = vt.layers['restrictions'];
      if (!layer) continue;

      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i).toGeoJSON(item.x, item.y, queryZoom);
        if (feature.geometry.type !== 'Point') continue;

        const [lon, lat] = feature.geometry.coordinates;
        const props = (feature.properties || {}) as Record<string, unknown>;
        const osmType = (props.osmType as 'node' | 'way') || 'node';
        const osmId = Number(props.osmId) || i;
        const key = `${osmType}/${osmId}`;

        if (!elementsMap.has(key)) {
          const tags: Record<string, string> = {};
          if (props.name) tags.name = String(props.name);
          if (props.maxheight) tags.maxheight = String(props.maxheight);
          if (props.maxwidth) tags.maxwidth = String(props.maxwidth);
          if (props.maxweight) tags.maxweight = String(props.maxweight);
          if (props.maxaxleload) tags.maxaxleload = String(props.maxaxleload);
          if (props.highway) tags.highway = String(props.highway);
          if (props.surface) tags.surface = String(props.surface);

          elementsMap.set(key, {
            type: osmType,
            id: osmId,
            lat,
            lon,
            tags,
          });
        }
      }
    } catch (decodeErr) {
      console.warn('Fehler beim Dekodieren von Vektorkachel:', decodeErr);
    }
  }

  return Array.from(elementsMap.values());
}
