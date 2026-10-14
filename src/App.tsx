import React, { useState, useRef, useMemo, useCallback } from 'react';
import type { TruckConfig, RestrictionItem, OsmElement } from './types';
import { fetchOsmRestrictions, processOsmElements } from './osmService';
import { MapView } from './MapView';
import { Controls } from './Controls';
import type { LatLngBounds } from 'leaflet';
import { AlertCircle, MapPin } from 'lucide-react';
import './App.css';

export const App: React.FC = () => {
  // Truck dimensions state
  const [truck, setTruck] = useState<TruckConfig>({
    height: 4.0,   // standard 4.0m
    width: 2.55,   // standard 2.55m
    weight: 40.0,  // standard 40t
    axleLoad: 11.5 // standard 11.5t
  });

  // Raw fetched items (cached for current bbox)
  const [rawElements, setRawElements] = useState<OsmElement[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'red' | 'yellow' | 'green'>('all');
  
  // Track bounds & zoom
  const currentBoundsRef = useRef<LatLngBounds | null>(null);
  const currentZoomRef = useRef<number>(13);
  const debounceTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load restrictions for given bounds
  const loadData = useCallback(async (bounds: LatLngBounds, zoom: number) => {
    // If zoom is too far out (< 11), Overpass will time out or return too huge datasets
    if (zoom < 11) {
      setError('Bitte zoome näher heran (mindestens Zoomstufe 11), um Hindernisse für diesen Bereich abzurufen.');
      setIsLoading(false);
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

    const south = bounds.getSouth();
    const west = bounds.getWest();
    const north = bounds.getNorth();
    const east = bounds.getEast();

    try {
      const elements = await fetchOsmRestrictions(south, west, north, east, controller.signal);
      setRawElements(elements);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Fetch error:', err);
      setError('Fehler beim Laden von der OSM Overpass API. Bitte prüfe deine Internetverbindung oder versuche es in wenigen Sekunden erneut.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // When map bounds change (e.g., pan/zoom)
  const handleBoundsChange = useCallback((bounds: LatLngBounds, zoom: number) => {
    currentBoundsRef.current = bounds;
    currentZoomRef.current = zoom;

    // Debounce to prevent spamming Overpass API while dragging
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      loadData(bounds, zoom);
    }, 600);
  }, [loadData]);

  // Manual refresh button
  const handleManualRefresh = () => {
    if (currentBoundsRef.current) {
      loadData(currentBoundsRef.current, currentZoomRef.current);
    }
  };

  // Re-evaluate restriction status whenever truck changes OR raw elements change
  const processedItems: RestrictionItem[] = useMemo(() => {
    return processOsmElements(rawElements, truck);
  }, [rawElements, truck]);

  // Statistics
  const counts = useMemo(() => {
    let red = 0;
    let yellow = 0;
    let green = 0;
    for (const item of processedItems) {
      if (item.status === 'red') red++;
      else if (item.status === 'yellow') yellow++;
      else if (item.status === 'green') green++;
    }
    return { red, yellow, green, total: processedItems.length };
  }, [processedItems]);

  // Filtered items
  const displayItems = useMemo(() => {
    if (filterStatus === 'all') return processedItems;
    return processedItems.filter((it) => it.status === filterStatus);
  }, [processedItems, filterStatus]);

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-logo">🚛</span>
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
            <div className="alert-banner">
              <AlertCircle size={18} />
              <span>{error}</span>
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
          />
        </aside>

        {/* Map View */}
        <main className="map-section">
          <MapView
            items={displayItems}
            truck={truck}
            onBoundsChange={handleBoundsChange}
            isLoading={isLoading}
          />
        </main>
      </div>
    </div>
  );
};

export default App;
