import React from 'react';
import type { TruckConfig } from './types';
import { Truck, ArrowUpDown, ArrowLeftRight, Weight, Gauge, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface ControlsProps {
  truck: TruckConfig;
  onChange: (newConfig: TruckConfig) => void;
  onRefresh: () => void;
  isLoading: boolean;
  filterStatus: 'all' | 'red' | 'yellow' | 'green';
  setFilterStatus: (val: 'all' | 'red' | 'yellow' | 'green') => void;
  counts: { red: number; yellow: number; green: number; total: number };
}

// Preset vehicle configurations
const PRESETS = [
  { name: 'Standard 40t Sattelzug', height: 4.0, width: 2.55, weight: 40.0, axleLoad: 11.5 },
  { name: '12t Verteiler-LKW', height: 3.6, width: 2.5, weight: 12.0, axleLoad: 8.0 },
  { name: '7.5t Transporter / Koffer', height: 3.2, width: 2.4, weight: 7.5, axleLoad: 5.0 },
  { name: '3.5t Sprinter', height: 2.7, width: 2.1, weight: 3.5, axleLoad: 2.2 },
  { name: 'Schwertransport / Gigaliner', height: 4.3, width: 3.0, weight: 50.0, axleLoad: 13.0 },
];

export const Controls: React.FC<ControlsProps> = ({
  truck,
  onChange,
  onRefresh,
  isLoading,
  filterStatus,
  setFilterStatus,
  counts,
}) => {
  return (
    <div className="sidebar-card">
      <div className="card-header">
        <div className="title-row">
          <Truck className="title-icon" size={24} />
          <h2 className="title-text">LKW-Parameter</h2>
        </div>
        <p className="subtitle">
          Passe die Maße deines Fahrzeugs an. Die Hindernisse auf der Karte werden sofort neu berechnet.
        </p>
      </div>

      {/* Preset Schnellwahl */}
      <div className="control-group">
        <label className="label-heading">Fahrzeug-Schnellwahl</label>
        <select
          className="preset-select"
          onChange={(e) => {
            const preset = PRESETS.find((p) => p.name === e.target.value);
            if (preset) {
              onChange({
                height: preset.height,
                width: preset.width,
                weight: preset.weight,
                axleLoad: preset.axleLoad,
              });
            }
          }}
          defaultValue="Standard 40t Sattelzug"
        >
          {PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.height}m / {p.weight}t)
            </option>
          ))}
        </select>
      </div>

      {/* Höhenbeschränkung */}
      <div className="slider-box">
        <div className="slider-label-row">
          <span className="slider-title">
            <ArrowUpDown size={18} className="icon-blue" />
            Höhe (m)
          </span>
          <span className="slider-val">{truck.height.toFixed(2)} m</span>
        </div>
        <input
          type="range"
          min="2.0"
          max="5.0"
          step="0.05"
          value={truck.height}
          onChange={(e) => onChange({ ...truck, height: parseFloat(e.target.value) })}
          className="range-slider"
        />
        <div className="slider-ticks">
          <span>2.0m</span>
          <span>3.0m</span>
          <span>4.0m</span>
          <span>5.0m</span>
        </div>
      </div>

      {/* Breitenbeschränkung */}
      <div className="slider-box">
        <div className="slider-label-row">
          <span className="slider-title">
            <ArrowLeftRight size={18} className="icon-cyan" />
            Breite (m)
          </span>
          <span className="slider-val">{truck.width.toFixed(2)} m</span>
        </div>
        <input
          type="range"
          min="1.8"
          max="4.0"
          step="0.05"
          value={truck.width}
          onChange={(e) => onChange({ ...truck, width: parseFloat(e.target.value) })}
          className="range-slider"
        />
        <div className="slider-ticks">
          <span>1.8m</span>
          <span>2.55m</span>
          <span>3.2m</span>
          <span>4.0m</span>
        </div>
      </div>

      {/* Gesamtgewichtsbeschränkung */}
      <div className="slider-box">
        <div className="slider-label-row">
          <span className="slider-title">
            <Weight size={18} className="icon-amber" />
            Gesamtgewicht (t)
          </span>
          <span className="slider-val">{truck.weight.toFixed(1)} t</span>
        </div>
        <input
          type="range"
          min="2.0"
          max="60.0"
          step="0.5"
          value={truck.weight}
          onChange={(e) => onChange({ ...truck, weight: parseFloat(e.target.value) })}
          className="range-slider"
        />
        <div className="slider-ticks">
          <span>2.0t</span>
          <span>18.0t</span>
          <span>40.0t</span>
          <span>60.0t</span>
        </div>
      </div>

      {/* Achslastbeschränkung */}
      <div className="slider-box">
        <div className="slider-label-row">
          <span className="slider-title">
            <Gauge size={18} className="icon-purple" />
            Achslast (t)
          </span>
          <span className="slider-val">{truck.axleLoad.toFixed(1)} t</span>
        </div>
        <input
          type="range"
          min="1.0"
          max="16.0"
          step="0.5"
          value={truck.axleLoad}
          onChange={(e) => onChange({ ...truck, axleLoad: parseFloat(e.target.value) })}
          className="range-slider"
        />
        <div className="slider-ticks">
          <span>1.0t</span>
          <span>6.0t</span>
          <span>11.5t</span>
          <span>16.0t</span>
        </div>
      </div>

      {/* Status-Übersicht & Filter */}
      <div className="stats-box">
        <div className="label-heading">Hindernisse im Sichtfeld ({counts.total})</div>
        <div className="filter-buttons">
          <button
            className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            Alle ({counts.total})
          </button>
          <button
            className={`filter-btn btn-red ${filterStatus === 'red' ? 'active' : ''}`}
            onClick={() => setFilterStatus('red')}
          >
            <XCircle size={15} /> Nicht passierbar ({counts.red})
          </button>
          <button
            className={`filter-btn btn-yellow ${filterStatus === 'yellow' ? 'active' : ''}`}
            onClick={() => setFilterStatus('yellow')}
          >
            <AlertTriangle size={15} /> Grenze ({counts.yellow})
          </button>
          <button
            className={`filter-btn btn-green ${filterStatus === 'green' ? 'active' : ''}`}
            onClick={() => setFilterStatus('green')}
          >
            <CheckCircle2 size={15} /> Passierbar ({counts.green})
          </button>
        </div>
      </div>

      {/* Refresh Button */}
      <button className="refresh-button" onClick={onRefresh} disabled={isLoading}>
        <RefreshCw size={18} className={isLoading ? 'spinning' : ''} />
        {isLoading ? 'Lade OSM-Daten...' : 'Ausschnitt neu laden'}
      </button>

      <div className="legend-box">
        <div className="legend-title">Legende</div>
        <div className="legend-item">
          <span className="legend-dot dot-red"></span>
          <span><strong>Rot:</strong> Über der Grenze (Hindernis blockiert LKW)</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-yellow"></span>
          <span><strong>Gelb:</strong> Genau an der Grenze (knappe Durchfahrt)</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-green"></span>
          <span><strong>Grün:</strong> OK (gefahrlos passierbar)</span>
        </div>
      </div>
    </div>
  );
};
