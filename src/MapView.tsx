import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RestrictionItem, TruckConfig } from './types';

// Fix standard Leaflet marker icons when bundled with Vite
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MapViewProps {
  items: RestrictionItem[];
  truck: TruckConfig;
  onBoundsChange: (bounds: L.LatLngBounds, zoom: number) => void;
  isLoading: boolean;
  onSelectFeature?: (item: RestrictionItem) => void;
}

export const MapView: React.FC<MapViewProps> = ({
  items,
  truck,
  onBoundsChange,
  isLoading,
  onSelectFeature,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default center: Frankfurt am Main (major transit hub in Germany)
    const map = L.map(mapContainerRef.current, {
      center: [50.1109, 8.6821],
      zoom: 13,
      zoomControl: false,
    });

    // Add zoom control top right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Standard OpenStreetMap Tile Layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    markersLayerRef.current = markersGroup;
    mapInstanceRef.current = map;

    // Trigger initial bounds
    onBoundsChange(map.getBounds(), map.getZoom());

    // Event listener for map moves
    const handleMoveEnd = () => {
      onBoundsChange(map.getBounds(), map.getZoom());
    };

    map.on('moveend', handleMoveEnd);

    return () => {
      map.off('moveend', handleMoveEnd);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [onBoundsChange]);

  // Update Markers whenever items change
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    const layer = markersLayerRef.current;
    layer.clearLayers();

    items.forEach((item) => {
      const color =
        item.status === 'red'
          ? '#ef4444'
          : item.status === 'yellow'
          ? '#eab308'
          : '#22c55e';

      const strokeColor =
        item.status === 'red'
          ? '#991b1b'
          : item.status === 'yellow'
          ? '#854d0e'
          : '#166534';

      // Restriction icon hint
      let symbol = '!';
      if (item.failedTypes.includes('height') || item.borderlineTypes.includes('height')) {
        symbol = '↕';
      } else if (item.failedTypes.includes('width') || item.borderlineTypes.includes('width')) {
        symbol = '↔';
      } else if (item.failedTypes.includes('weight') || item.borderlineTypes.includes('weight')) {
        symbol = '⚖';
      } else if (item.failedTypes.includes('axleLoad') || item.borderlineTypes.includes('axleLoad')) {
        symbol = '⊜';
      } else if (item.status === 'green') {
        symbol = '✓';
      }

      const customIcon = L.divIcon({
        className: 'custom-restriction-marker',
        html: `
          <div style="
            background-color: ${color};
            border: 2px solid ${strokeColor};
            color: #ffffff;
            font-weight: bold;
            font-size: 13px;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 6px rgba(0,0,0,0.4);
            cursor: pointer;
            transition: transform 0.15s ease-in-out;
          ">
            ${symbol}
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      });

      const marker = L.marker([item.lat, item.lon], { icon: customIcon });

      // Build popup content
      const statusTitle =
        item.status === 'red'
          ? '<span style="color: #dc2626; font-weight: bold;">⚠️ NICHT PASSIERBAR (Überschritten)</span>'
          : item.status === 'yellow'
          ? '<span style="color: #ca8a04; font-weight: bold;">⚡ VORSICHT (An der Grenze)</span>'
          : '<span style="color: #16a34a; font-weight: bold;">✅ PASSIERBAR (OK)</span>';

      const restrictionLines = [
        item.maxHeight !== undefined ? `<tr><td><strong>Max. Höhe:</strong></td><td>${item.maxHeight.toFixed(2)} m</td></tr>` : '',
        item.maxWidth !== undefined ? `<tr><td><strong>Max. Breite:</strong></td><td>${item.maxWidth.toFixed(2)} m</td></tr>` : '',
        item.maxWeight !== undefined ? `<tr><td><strong>Max. Gewicht:</strong></td><td>${item.maxWeight.toFixed(1)} t</td></tr>` : '',
        item.maxAxleLoad !== undefined ? `<tr><td><strong>Max. Achslast:</strong></td><td>${item.maxAxleLoad.toFixed(1)} t</td></tr>` : '',
      ].filter(Boolean).join('');

      const evalLines = item.infoTexts
        .map((text) => `<li style="margin-bottom: 2px;">${text}</li>`)
        .join('');

      const osmLink = `https://www.openstreetmap.org/${item.osmType}/${item.osmId}`;

      const popupHtml = `
        <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 13px; min-width: 220px; line-height: 1.4;">
          <div style="margin-bottom: 6px; font-size: 14px;">${statusTitle}</div>
          ${item.name ? `<div style="font-weight: 600; margin-bottom: 6px; color: #1e293b;">${item.name}</div>` : ''}
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
            <tbody>
              ${restrictionLines}
            </tbody>
          </table>
          <div style="font-weight: 600; font-size: 12px; color: #475569; margin-bottom: 3px;">Status vs. LKW:</div>
          <ul style="padding-left: 18px; margin: 0 0 8px 0; font-size: 12px; color: #334155;">
            ${evalLines}
          </ul>
          <div style="border-top: 1px solid #e2e8f0; padding-top: 5px; font-size: 11px; color: #64748b;">
            OSM: <a href="${osmLink}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">${item.osmType}/${item.osmId}</a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on('click', () => {
        if (onSelectFeature) onSelectFeature(item);
      });

      marker.addTo(layer);
    });
  }, [items, truck, onSelectFeature]);

  // Geolocation button helper
  const handleLocateMe = () => {
    if (!mapInstanceRef.current) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapInstanceRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 14);
        },
        (err) => {
          alert('Standort konnte nicht ermittelt werden: ' + err.message);
        }
      );
    } else {
      alert('Geolocation wird von diesem Browser nicht unterstützt.');
    }
  };

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />
      <button className="map-locate-btn" onClick={handleLocateMe} title="Zu meinem Standort">
        📍 Mein Standort
      </button>
      {isLoading && (
        <div className="map-loading-overlay">
          <div className="spinner"></div>
          <span>Lade Hindernisdaten von OpenStreetMap...</span>
        </div>
      )}
    </div>
  );
};
