import type { TruckConfig, RestrictionItem, StatusColor, RestrictionType, OsmElement } from './types';

/**
 * Custom error class for OpenStreetMap / Overpass API errors
 * with user-friendly error messages and optional HTTP status code.
 */
export class OsmApiError extends Error {
  public statusCode?: number;
  public userMessage: string;
  public rawMessage?: string;

  constructor(userMessage: string, statusCode?: number, rawMessage?: string) {
    super(userMessage);
    this.name = 'OsmApiError';
    this.userMessage = userMessage;
    this.statusCode = statusCode;
    this.rawMessage = rawMessage;
  }
}

/**
 * Maps any error encountered during OSM fetching to a meaningful, actionable German message.
 */
export function getErrorMessage(err: unknown, currentZoom?: number): string {
  if (currentZoom !== undefined && currentZoom < 11) {
    return `Kartenausschnitt zu groß (Zoomstufe ${currentZoom}): Bitte zoome näher heran (mindestens Stufe 11), um Hindernisse für diesen Bereich abzurufen.`;
  }
  if (err instanceof OsmApiError) {
    return err.userMessage;
  }
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'Keine Internetverbindung vorhanden. Bitte überprüfe deine Netzwerkverbindung.';
  }
  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return 'Verbindung zum OSM Overpass-Server fehlgeschlagen. Bitte prüfe deine Internetverbindung oder Werbeblocker-Einstellungen.';
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return 'Die Datenabfrage wurde abgebrochen.';
    }
    if (err.message && err.message.trim().length > 0) {
      return `Fehler bei der Abfrage: ${err.message}`;
    }
  }
  return 'Unerwarteter Fehler beim Abrufen der Kartendaten von OpenStreetMap.';
}

/**
 * Parses OSM dimension/weight strings into standard float numbers.
 * Examples in OSM:
 * - "3.8" -> 3.8
 * - "3.8m" or "3.8 m" -> 3.8
 * - "12t" or "12 tonnes" or "12" -> 12
 * - "12.5" -> 12.5
 * - "13'6\"" (feet and inches) -> ~4.11
 * - "default", "none", "unsigned" -> NaN / ignored
 */
export function parseOsmValue(valStr: string | undefined): number | undefined {
  if (!valStr) return undefined;
  const s = valStr.trim().toLowerCase();

  // If default, none, unsigned, etc.
  if (['none', 'default', 'unsigned', 'no', 'yes'].includes(s)) {
    return undefined;
  }

  // Check feet and inches e.g. 13'6" or 13' 6"
  const feetInchesMatch = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
  if (feetInchesMatch) {
    const feet = parseFloat(feetInchesMatch[1]);
    const inches = feetInchesMatch[2] ? parseFloat(feetInchesMatch[2]) : 0;
    const meters = feet * 0.3048 + inches * 0.0254;
    return Math.round(meters * 100) / 100;
  }

  // Replace comma with dot
  const normalized = s.replace(',', '.');

  // Extract first floating-point number
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0) {
      // Check for lbs/pounds or cwt (rare in European OSM, but just in case)
      if (normalized.includes('lbs') || normalized.includes('pound')) {
        return Math.round((num * 0.000453592) * 100) / 100;
      }
      return num;
    }
  }

  return undefined;
}

/**
 * Builds the Overpass QL query string for bounding box.
 * bbox format for Overpass: south, west, north, east
 * Uses 'qt' (quadtile sorting) for significantly faster execution on the Overpass server.
 */
export function buildOverpassQuery(south: number, west: number, north: number, east: number): string {
  const bboxStr = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:25];
(
  node["maxheight"](${bboxStr});
  way["maxheight"](${bboxStr});
  node["maxwidth"](${bboxStr});
  way["maxwidth"](${bboxStr});
  node["maxweight"](${bboxStr});
  way["maxweight"](${bboxStr});
  node["maxaxleload"](${bboxStr});
  way["maxaxleload"](${bboxStr});
);
out center tags qt;
  `.trim();
}

/**
 * Public Overpass API endpoints (can fallback if one fails/rate-limits)
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

let currentEndpointIndex = 0;

export async function fetchOsmRestrictions(
  south: number,
  west: number,
  north: number,
  east: number,
  abortSignal?: AbortSignal
): Promise<OsmElement[]> {
  const query = buildOverpassQuery(south, west, north, east);
  
  let lastError: unknown = null;
  // Try endpoints
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[(currentEndpointIndex + attempt) % OVERPASS_ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: abortSignal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new OsmApiError(
            'Zu viele Anfragen an die Overpass API (Rate Limit erreicht). Bitte warte ca. 10–20 Sekunden und versuche es erneut.',
            429,
            `HTTP 429 Too Many Requests (${endpoint})`
          );
        } else if (response.status === 504 || response.status === 408) {
          throw new OsmApiError(
            'Zeitüberschreitung beim Abruf: Der gewählte Kartenausschnitt enthält möglicherweise zu viele Daten. Bitte zoome etwas näher heran.',
            response.status,
            `HTTP ${response.status} Timeout (${endpoint})`
          );
        } else if (response.status >= 500) {
          throw new OsmApiError(
            `Der OpenStreetMap-Server ist vorübergehend nicht erreichbar oder überlastet (HTTP ${response.status}). Bitte versuche es gleich noch einmal.`,
            response.status,
            `HTTP ${response.status} Server Error (${endpoint})`
          );
        } else {
          throw new OsmApiError(
            `Overpass API meldet HTTP-Fehler ${response.status}: ${response.statusText}`,
            response.status,
            `HTTP ${response.status} (${endpoint})`
          );
        }
      }

      let json: { remark?: string; elements?: OsmElement[] };
      try {
        json = await response.json();
      } catch {
        throw new OsmApiError(
          'Ungültige Antwort von der Overpass API erhalten (kein JSON). Der Dienst ist möglicherweise temporär gestört.',
          undefined,
          `Invalid JSON response from ${endpoint}`
        );
      }

      if (json.remark && typeof json.remark === 'string') {
        const remarkLower = json.remark.toLowerCase();
        if (remarkLower.includes('timed out')) {
          throw new OsmApiError(
            'Zeitüberschreitung bei der Abfrage: Der Kartenausschnitt ist zu datenintensiv. Bitte zoome näher heran.',
            undefined,
            json.remark
          );
        }
        if (remarkLower.includes('out of memory') || remarkLower.includes('memory')) {
          throw new OsmApiError(
            'Speicherlimit der Overpass API überschritten. Bitte verkleinere den Ausschnitt durch Näherheranzoomen.',
            undefined,
            json.remark
          );
        }
        if (remarkLower.includes('runtime error')) {
          throw new OsmApiError(
            `Overpass-API-Laufzeitfehler: ${json.remark}`,
            undefined,
            json.remark
          );
        }
      }

      if (!Array.isArray(json.elements)) {
        throw new OsmApiError(
          'Antwort der Overpass API enthält keine gültigen Element-Daten.',
          undefined,
          'json.elements is not an array'
        );
      }

      currentEndpointIndex = (currentEndpointIndex + attempt) % OVERPASS_ENDPOINTS.length;
      return json.elements;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      lastError = err;
      console.warn(`Error contacting Overpass endpoint ${endpoint}:`, err);
    }
  }

  if (lastError instanceof OsmApiError) {
    throw lastError;
  }
  if (lastError instanceof Error) {
    throw new OsmApiError(
      `Fehler beim Laden der OSM-Daten: ${lastError.message}`,
      undefined,
      lastError.message
    );
  }
  throw new OsmApiError('Alle Overpass-API-Server sind derzeit nicht erreichbar. Bitte versuche es in Kürze erneut.');
}

/**
 * Compare rule:
 * - Red (Over limit): Truck value > restriction limit
 *   e.g. Truck height 4.0m, Bridge max 3.8m -> CRITICAL DANGER (Red)
 * - Yellow (At/Near border): Truck value is within threshold of restriction or equal
 *   e.g. Truck height == 3.8m or slightly less (within 0.15m / 5% margin)
 * - Green (Passable / OK): Truck value is safely below restriction limit
 */
export function evaluateStatus(
  truck: TruckConfig,
  item: {
    maxHeight?: number;
    maxWidth?: number;
    maxWeight?: number;
    maxAxleLoad?: number;
  }
): {
  status: StatusColor;
  failedTypes: RestrictionType[];
  borderlineTypes: RestrictionType[];
  infoTexts: string[];
} {
  const failedTypes: RestrictionType[] = [];
  const borderlineTypes: RestrictionType[] = [];
  const infoTexts: string[] = [];

  if (item.maxHeight !== undefined) {
    if (truck.height > item.maxHeight) {
      failedTypes.push('height');
      infoTexts.push(`Höhe überschritten: LKW ${truck.height.toFixed(2)}m > Max ${item.maxHeight.toFixed(2)}m (+${(truck.height - item.maxHeight).toFixed(2)}m)`);
    } else if (truck.height >= item.maxHeight - 0.15) {
      borderlineTypes.push('height');
      infoTexts.push(`Höhe an der Grenze: LKW ${truck.height.toFixed(2)}m / Max ${item.maxHeight.toFixed(2)}m`);
    } else {
      infoTexts.push(`Höhe OK: LKW ${truck.height.toFixed(2)}m ≤ Max ${item.maxHeight.toFixed(2)}m`);
    }
  }

  if (item.maxWidth !== undefined) {
    if (truck.width > item.maxWidth) {
      failedTypes.push('width');
      infoTexts.push(`Breite überschritten: LKW ${truck.width.toFixed(2)}m > Max ${item.maxWidth.toFixed(2)}m (+${(truck.width - item.maxWidth).toFixed(2)}m)`);
    } else if (truck.width >= item.maxWidth - 0.1) {
      borderlineTypes.push('width');
      infoTexts.push(`Breite an der Grenze: LKW ${truck.width.toFixed(2)}m / Max ${item.maxWidth.toFixed(2)}m`);
    } else {
      infoTexts.push(`Breite OK: LKW ${truck.width.toFixed(2)}m ≤ Max ${item.maxWidth.toFixed(2)}m`);
    }
  }

  if (item.maxWeight !== undefined) {
    if (truck.weight > item.maxWeight) {
      failedTypes.push('weight');
      infoTexts.push(`Gewicht überschritten: LKW ${truck.weight.toFixed(1)}t > Max ${item.maxWeight.toFixed(1)}t (+${(truck.weight - item.maxWeight).toFixed(1)}t)`);
    } else if (truck.weight >= item.maxWeight - 1.0) {
      borderlineTypes.push('weight');
      infoTexts.push(`Gewicht an der Grenze: LKW ${truck.weight.toFixed(1)}t / Max ${item.maxWeight.toFixed(1)}t`);
    } else {
      infoTexts.push(`Gewicht OK: LKW ${truck.weight.toFixed(1)}t ≤ Max ${item.maxWeight.toFixed(1)}t`);
    }
  }

  if (item.maxAxleLoad !== undefined) {
    if (truck.axleLoad > item.maxAxleLoad) {
      failedTypes.push('axleLoad');
      infoTexts.push(`Achslast überschritten: LKW ${truck.axleLoad.toFixed(1)}t > Max ${item.maxAxleLoad.toFixed(1)}t (+${(truck.axleLoad - item.maxAxleLoad).toFixed(1)}t)`);
    } else if (truck.axleLoad >= item.maxAxleLoad - 0.5) {
      borderlineTypes.push('axleLoad');
      infoTexts.push(`Achslast an der Grenze: LKW ${truck.axleLoad.toFixed(1)}t / Max ${item.maxAxleLoad.toFixed(1)}t`);
    } else {
      infoTexts.push(`Achslast OK: LKW ${truck.axleLoad.toFixed(1)}t ≤ Max ${item.maxAxleLoad.toFixed(1)}t`);
    }
  }

  let status: StatusColor = 'green';
  if (failedTypes.length > 0) {
    status = 'red';
  } else if (borderlineTypes.length > 0) {
    status = 'yellow';
  }

  return { status, failedTypes, borderlineTypes, infoTexts };
}

/**
 * Transforms raw Overpass elements to typed RestrictionItems
 */
export function processOsmElements(elements: OsmElement[], truck: TruckConfig): RestrictionItem[] {
  const result: RestrictionItem[] = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const maxHeight = parseOsmValue(tags['maxheight']);
    const maxWidth = parseOsmValue(tags['maxwidth']);
    const maxWeight = parseOsmValue(tags['maxweight']);
    const maxAxleLoad = parseOsmValue(tags['maxaxleload']);

    // Check if at least one restriction is present
    if (
      maxHeight === undefined &&
      maxWidth === undefined &&
      maxWeight === undefined &&
      maxAxleLoad === undefined
    ) {
      continue;
    }

    // Coordinates: node has lat, lon; way/relation with 'out center' has center.lat, center.lon
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;

    if (lat === undefined || lon === undefined) {
      continue;
    }

    const { status, failedTypes, borderlineTypes, infoTexts } = evaluateStatus(truck, {
      maxHeight,
      maxWidth,
      maxWeight,
      maxAxleLoad,
    });

    const name = tags.name || tags.bridge_name || tags.description || tags.ref;

    result.push({
      id: `${el.type}/${el.id}`,
      osmType: el.type,
      osmId: el.id,
      lat,
      lon,
      name,
      tags,
      maxHeight,
      maxWidth,
      maxWeight,
      maxAxleLoad,
      status,
      failedTypes,
      borderlineTypes,
      infoTexts,
    });
  }

  return result;
}
