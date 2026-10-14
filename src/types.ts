export interface TruckConfig {
  height: number;      // in meters (e.g. 3.8m)
  width: number;       // in meters (e.g. 2.5m)
  weight: number;      // total weight in metric tons (e.g. 24t)
  axleLoad: number;    // axle load in metric tons (e.g. 10t)
}

export type RestrictionType = 'height' | 'width' | 'weight' | 'axleLoad';

export type StatusColor = 'green' | 'yellow' | 'red';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string>;
  nodes?: number[];
  members?: Array<{
    type: string;
    ref: number;
    role: string;
  }>;
}

export interface RestrictionItem {
  id: string; // OSM id, e.g. "node/123" or "way/456"
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  lat: number;
  lon: number;
  name?: string;
  tags: Record<string, string>;
  
  // Parsed restriction values (in meters / metric tons)
  maxHeight?: number;
  maxWidth?: number;
  maxWeight?: number;
  maxAxleLoad?: number;

  // Evaluated for truck
  status: StatusColor;
  failedTypes: RestrictionType[];
  borderlineTypes: RestrictionType[];
  infoTexts: string[];
}
