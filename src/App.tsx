import React, { useState, useRef, useMemo, useCallback } from 'react';
import type { TruckConfig, RestrictionItem, OsmElement } from './types';
import { fetchOsmRestrictions, processOsmElements, getErrorMessage } from './osmService';
import { MapView } from './MapView';
import { Controls } from './Controls';
import type { LatLngBounds } from 'leaflet';
import { AlertCircle, MapPin, X } from 'lucide-react';
import './App.css';

export const App: React.FC = () => {
  // Truck dimensions state
  const [truck, setTruck] = useState<TruckConfig>({
    height: 4.0,   // standard 4.0m
    width: 2.55,   // standard 2.55m
    weight: 40.0,  // standard 40t
    axleLoad: 11.5 // standard 11.5t
  });

  // Cached elements (all deduplicated elements fetched so far)
  const [rawElements, setRawElements] = useState<OsmElement[]>([]);
  const [currentBounds, setCurrentBounds] = useState<LatLngBounds | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'red' | 'yellow' | 'green'>('all');

  // Track bounds, zoom & cache references
  const currentBoundsRef = useRef<LatLngBounds | null>(null);
  const currentZoomRef = useRef<number>(13);
  const elementsCacheRef = useRef<Map<string, OsmElement>>(new Map());
  const loadedBoundsRef = useRef<LatLngBounds[]>([]);
  const debounceTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load restrictions for given bounds with padding and coverage check
  const loadData = useCallback(async (bounds: LatLngBounds, zoom: number, forceRefresh = false) => {
    // If zoom is too far out (< 11), Overpass will time out or return too huge datasets
    if (zoom < 11) {
      setError(`Kartenausschnitt zu groß (Zoomstufe ${zoom}): Bitte zoome näher heran (mindestens Stufe 11), um Hindernisse für diesen Bereich abzurufen.`);
      setIsLoading(false);
      return;
    }

    // Check if the current view is already fully covered by a previously fetched padded area
    if (!forceRefresh && loadedBoundsRef.current.some((loadedBox) => loadedBox.contains(bounds))) {
      // Area is already cached; no network request needed
      return;
    }

    // Cancel any ongoing fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    // Fetch with 25% padding so that slight panning or zooming in does not trigger another request
    const fetchBounds = bounds.pad(0.25);
    const south = Math.max(-85, fetchBounds.getSouth());
    const west = Math.max(-180, fetchBounds.getWest());
    const north = Math.min(85, fetchBounds.getNorth());
    const east = Math.min(180, fetchBounds.getEast());

    try {
      const elements = await fetchOsmRestrictions(south, west, north, east, controller.signal);

      // Merge into in-memory cache
      for (const el of elements) {
        const key = `${el.type}/${el.id}`;
        elementsCacheRef.current.set(key, el);
      }

      // Record loaded bounds
      loadedBoundsRef.current.push(fetchBounds);
      if (loadedBoundsRef.current.length > 25) {
        loadedBoundsRef.current.shift();
      }

      setRawElements(Array.from(elementsCacheRef.current.values()));
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Fetch error:', err);
      setError(getErrorMessage(err, zoom));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // When map bounds change (e.g., pan/zoom)
  const handleBoundsChange = useCallback((bounds: LatLngBounds, zoom: number) => {
    currentBoundsRef.current = bounds;
    currentZoomRef.current = zoom;
    setCurrentBounds(bounds);

    // If the area is already covered by cache and zoom is valid, update instantly without debouncing or fetching
    if (zoom >= 11 && loadedBoundsRef.current.some((loadedBox) => loadedBox.contains(bounds))) {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      return;
    }

    // Debounce to prevent spamming Overpass API while dragging into new areas
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      loadData(bounds, zoom);
    }, 500);
  }, [loadData]);

  // Manual refresh button (forceRefresh bypasses cache coverage check)
  const handleManualRefresh = useCallback(() => {
    if (!currentBoundsRef.current) {
      setError('Kartenausschnitt noch nicht initialisiert. Bitte bewege die Karte kurz und versuche es erneut.');
      return;
    }
    loadData(currentBoundsRef.current, currentZoomRef.current, true);
  }, [loadData]);

  const handleDismissError = useCallback(() => {
    setError(null);
  }, []);

  // Re-evaluate restriction status whenever truck changes OR raw elements change
  const processedItems: RestrictionItem[] = useMemo(() => {
    return processOsmElements(rawElements, truck);
  }, [rawElements, truck]);

  // Filter items to current viewport (+10% margin so boundary markers render smoothly)
  const visibleItems = useMemo(() => {
    if (!currentBounds) return processedItems;
    const viewPadding = currentBounds.pad(0.1);
    return processedItems.filter((item) => viewPadding.contains([item.lat, item.lon]));
  }, [processedItems, currentBounds]);

  // Statistics for visible area
  const counts = useMemo(() => {
    let red = 0;
    let yellow = 0;
    let green = 0;
    for (const item of visibleItems) {
      if (item.status === 'red') red++;
      else if (item.status === 'yellow') yellow++;
      else if (item.status === 'green') green++;
    }
    return { red, yellow, green, total: visibleItems.length };
  }, [visibleItems]);

  // Filtered items
  const displayItems = useMemo(() => {
    if (filterStatus === 'all') return visibleItems;
    return visibleItems.filter((it) => it.status === filterStatus);
  }, [visibleItems, filterStatus]);

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-logo">🚚</span>
          <div className="brand-titles">
            <h1>LKW-Hinderniskarte (OSM)</h1>
            <p>Echtzeit-Prüfung von Durchfahrts-, Breiten- & Gewichtsbeschränkungen</p>
          </div>
        </div>
        <div className="header-info">
          <div className="badge badge-info">
            <MapPin size={14} /> Beliebiger Kartenausschnitt
          </div>
          <div className="badge badge-osm">
            Overpass OpenStreetMap API
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="main-content">
        {/* Left Sidebar Controls */}
        <aside className="sidebar">
          {error && (
            <div className="alert-banner" role="alert">
              <AlertCircle size={18} className="alert-banner-icon" />
              <div className="alert-banner-content">
                <strong>Fehler beim Laden des Ausschnitts:</strong>
                <span>{error}</span>
              </div>
              <button
                type="button"
                className="alert-banner-close"
                onClick={handleDismissError}
                title="Meldung schließen"
                aria-label="Meldung schließen"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <Controls
            truck={truck}
            onChange={setTruck}
            onRefresh={handleManualRefresh}
            isLoading={isLoading}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            counts={counts}
            error={error}
            onDismissError={handleDismissError}
          />
        </aside>

        {/* Map View */}
        <main className="map-section">
          <MapView
            items={displayItems}
            truck={truck}
            onBoundsChange={handleBoundsChange}
            isLoading={isLoading}
            error={error}
          />
        </main>
      </div>
    </div>
  );
};

export default App;
