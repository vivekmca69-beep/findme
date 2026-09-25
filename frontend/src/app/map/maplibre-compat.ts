declare const maplibregl: any;

export namespace L {
  export type LatLngExpression = [number, number] | { lat: number; lng: number };

  type PaddingTuple = [number, number];

  interface FitOptions {
    padding?: PaddingTuple | number;
    paddingTopLeft?: PaddingTuple;
    paddingBottomRight?: PaddingTuple;
    maxZoom?: number;
    animate?: boolean;
    duration?: number;
  }

  interface ViewOptions {
    animate?: boolean;
  }

  interface PolylineOptions {
    color?: string;
    weight?: number;
    opacity?: number;
    dashArray?: string;
    lineCap?: string;
    lineJoin?: string;
    interactive?: boolean;
  }

  interface CircleMarkerOptions {
    radius?: number;
    weight?: number;
    color?: string;
    fillColor?: string;
    fillOpacity?: number;
  }

  interface TooltipOptions {
    permanent?: boolean;
    direction?: string;
    offset?: [number, number];
  }

  function toLngLat(value: LatLngExpression): [number, number] {
    if (Array.isArray(value)) return [value[1], value[0]];
    return [value.lng, value.lat];
  }

  function toLatLng(value: LatLngExpression): [number, number] {
    if (Array.isArray(value)) return [value[0], value[1]];
    return [value.lat, value.lng];
  }

  function parseDashArray(value?: string): number[] | undefined {
    if (!value) return undefined;
    const nums = value.split(',').map(x => Number(x.trim())).filter(Number.isFinite);
    return nums.length ? nums.map(x => Math.max(0.1, x / 3)) : undefined;
  }

  let sequence = 0;
  function unique(prefix: string): string {
    sequence += 1;
    return `findme-${prefix}-${sequence}`;
  }

  export class LatLngBounds {
    private west = Number.POSITIVE_INFINITY;
    private south = Number.POSITIVE_INFINITY;
    private east = Number.NEGATIVE_INFINITY;
    private north = Number.NEGATIVE_INFINITY;

    constructor(points: LatLngExpression[] = []) {
      points.forEach(p => this.extend(p));
    }

    extend(point: LatLngExpression): this {
      const [lat, lng] = toLatLng(point);
      this.west = Math.min(this.west, lng);
      this.east = Math.max(this.east, lng);
      this.south = Math.min(this.south, lat);
      this.north = Math.max(this.north, lat);
      return this;
    }

    toArray(): [[number, number], [number, number]] {
      if (!Number.isFinite(this.west)) return [[0, 0], [0, 0]];
      return [[this.west, this.south], [this.east, this.north]];
    }
  }

  export class Map {
    readonly raw: any;
    private ready = false;
    private readyCallbacks: Array<() => void> = [];
    private baseMode: 'street' | 'satellite' = 'street';

    constructor(container: string, options: any = {}) {
      const center = options.center ?? [78.9629, 20.5937];
      this.raw = new maplibregl.Map({
        container,
        style: 'https://tiles.openfreemap.org/styles/bright',
        center,
        zoom: options.zoom ?? 5,
        bearing: 0,
        pitch: 0,
        antialias: true,
        attributionControl: true,
        cooperativeGestures: false,
        maxPitch: 70
      });

      // Google-Maps-like interaction model: pinch zoom + two-finger rotation,
      // two-finger pitch/tilt, mouse/right-drag rotation, smooth inertia.
      this.raw.touchZoomRotate.enable();
      this.raw.touchZoomRotate.enableRotation();
      this.raw.touchPitch.enable();
      this.raw.dragRotate.enable();

      this.raw.addControl(new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: true
      }), 'bottom-right');

      this.raw.on('load', () => {
        this.ready = true;
        this.installSatelliteLayers();
        const callbacks = [...this.readyCallbacks];
        this.readyCallbacks.length = 0;
        callbacks.forEach(cb => cb());
      });
    }

    onReady(callback: () => void): void {
      if (this.ready && this.raw.isStyleLoaded()) callback();
      else this.readyCallbacks.push(callback);
    }

    private installSatelliteLayers(): void {
      if (!this.raw.getSource('findme-satellite')) {
        this.raw.addSource('findme-satellite', {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community'
        });
      }
      if (!this.raw.getLayer('findme-satellite')) {
        this.raw.addLayer({
          id: 'findme-satellite',
          type: 'raster',
          source: 'findme-satellite',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 1 }
        });
      }

      if (!this.raw.getSource('findme-satellite-labels')) {
        this.raw.addSource('findme-satellite-labels', {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Reference labels © Esri'
        });
      }
      if (!this.raw.getLayer('findme-satellite-labels')) {
        this.raw.addLayer({
          id: 'findme-satellite-labels',
          type: 'raster',
          source: 'findme-satellite-labels',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 1 }
        });
      }
      this.applyBaseMode();
    }

    setBaseMode(mode: 'street' | 'satellite'): void {
      this.baseMode = mode;
      this.onReady(() => this.applyBaseMode());
    }

    private applyBaseMode(): void {
      const satelliteVisibility = this.baseMode === 'satellite' ? 'visible' : 'none';
      if (this.raw.getLayer('findme-satellite')) {
        this.raw.setLayoutProperty('findme-satellite', 'visibility', satelliteVisibility);
      }
      if (this.raw.getLayer('findme-satellite-labels')) {
        this.raw.setLayoutProperty('findme-satellite-labels', 'visibility', satelliteVisibility);
      }
    }

    setView(center: LatLngExpression, zoom?: number, options: ViewOptions = {}): this {
      const [lng, lat] = toLngLat(center);
      const targetZoom = zoom ?? this.raw.getZoom();
      if (options.animate) {
        this.raw.easeTo({ center: [lng, lat], zoom: targetZoom, duration: 650, essential: true });
      } else {
        this.raw.jumpTo({ center: [lng, lat], zoom: targetZoom });
      }
      return this;
    }

    fitBounds(bounds: LatLngBounds, options: FitOptions = {}): this {
      const padding = this.normalizePadding(options);
      const duration = options.animate === false ? 0 : this.normalizeDuration(options.duration);
      this.raw.fitBounds(bounds.toArray(), {
        padding,
        maxZoom: options.maxZoom,
        duration,
        bearing: this.raw.getBearing(),
        pitch: this.raw.getPitch(),
        essential: true
      });
      return this;
    }

    private normalizePadding(options: FitOptions): any {
      if (typeof options.padding === 'number') return options.padding;
      if (Array.isArray(options.padding)) {
        return { top: options.padding[1], right: options.padding[0], bottom: options.padding[1], left: options.padding[0] };
      }
      if (options.paddingTopLeft || options.paddingBottomRight) {
        const tl = options.paddingTopLeft ?? [0, 0];
        const br = options.paddingBottomRight ?? [0, 0];
        return { top: tl[1], left: tl[0], right: br[0], bottom: br[1] };
      }
      return 40;
    }

    private normalizeDuration(value?: number): number {
      if (value == null) return 650;
      return value <= 10 ? Math.round(value * 1000) : value;
    }

    getZoom(): number { return this.raw.getZoom(); }
    getBearing(): number { return this.raw.getBearing(); }
    getPitch(): number { return this.raw.getPitch(); }
    invalidateSize(_options?: any): void { this.raw.resize(); }
    resize(): void { this.raw.resize(); }

    removeLayer(layer: TileLayer | Polyline): this {
      if (layer instanceof Polyline) layer.remove();
      return this;
    }
  }

  export class TileLayer {
    private kind: 'street' | 'satellite' | 'labels';
    constructor(private url: string, _options: any = {}) {
      this.kind = url.includes('World_Imagery') ? 'satellite'
        : url.includes('World_Boundaries') ? 'labels'
        : 'street';
    }
    addTo(map: Map): this {
      if (this.kind === 'street') map.setBaseMode('street');
      if (this.kind === 'satellite') map.setBaseMode('satellite');
      return this;
    }
  }

  export class CircleMarker {
    private marker?: any;
    private map?: Map;
    private tooltipText = '';
    private removed = false;
    private readonly element: HTMLDivElement;
    private readonly dot: HTMLDivElement;
    private readonly label: HTMLDivElement;
    private latLng: LatLngExpression;

    constructor(latLng: LatLngExpression, private options: CircleMarkerOptions = {}) {
      this.latLng = latLng;
      this.element = document.createElement('div');
      this.element.className = 'findme-map-marker';
      this.dot = document.createElement('div');
      this.dot.className = 'findme-map-marker__dot';
      this.label = document.createElement('div');
      this.label.className = 'findme-map-marker__label';
      this.element.append(this.label, this.dot);
      this.applyStyle();
    }

    private applyStyle(): void {
      const radius = this.options.radius ?? 10;
      const diameter = radius * 2;
      this.dot.style.width = `${diameter}px`;
      this.dot.style.height = `${diameter}px`;
      this.dot.style.background = this.options.fillColor ?? '#2563eb';
      this.dot.style.opacity = String(this.options.fillOpacity ?? 1);
      this.dot.style.border = `${this.options.weight ?? 3}px solid ${this.options.color ?? '#fff'}`;
    }

    addTo(map: Map): this {
      this.map = map;
      const add = () => {
        if (this.removed || this.marker) return;
        const [lng, lat] = toLngLat(this.latLng);
        this.marker = new maplibregl.Marker({ element: this.element, anchor: 'bottom', offset: [0, this.options.radius ?? 10] })
          .setLngLat([lng, lat])
          .addTo(map.raw);
      };
      map.onReady(add);
      return this;
    }

    setLatLng(latLng: LatLngExpression): this {
      this.latLng = latLng;
      if (this.marker) {
        const [lng, lat] = toLngLat(latLng);
        this.marker.setLngLat([lng, lat]);
      }
      return this;
    }

    bindTooltip(text: string, _options: TooltipOptions = {}): this {
      this.tooltipText = text;
      this.label.textContent = text;
      this.label.style.display = text ? 'block' : 'none';
      return this;
    }

    remove(): this {
      this.removed = true;
      this.marker?.remove();
      this.marker = undefined;
      return this;
    }

    bringToFront(): this { return this; }
  }

  export class Polyline {
    private map?: Map;
    private removed = false;
    private points: LatLngExpression[];
    private readonly sourceId = unique('line-src');
    private readonly layerId = unique('line');

    constructor(points: LatLngExpression[], private options: PolylineOptions = {}) {
      this.points = points;
    }

    addTo(map: Map): this {
      this.map = map;
      this.removed = false;
      map.onReady(() => this.ensureLayer());
      return this;
    }

    private ensureLayer(): void {
      if (!this.map || this.removed) return;
      const raw = this.map.raw;
      const data = this.geoJson();
      if (!raw.getSource(this.sourceId)) {
        raw.addSource(this.sourceId, { type: 'geojson', data });
      }
      if (!raw.getLayer(this.layerId)) {
        const paint: any = {
          'line-color': this.options.color ?? '#2563eb',
          'line-width': this.options.weight ?? 5,
          'line-opacity': this.options.opacity ?? 1
        };
        const dash = parseDashArray(this.options.dashArray);
        if (dash) paint['line-dasharray'] = dash;
        raw.addLayer({
          id: this.layerId,
          type: 'line',
          source: this.sourceId,
          layout: {
            'line-cap': (this.options.lineCap as any) ?? 'round',
            'line-join': (this.options.lineJoin as any) ?? 'round'
          },
          paint
        });
      }
    }

    private geoJson(): any {
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: this.points.map(toLngLat)
        }
      };
    }

    setLatLngs(points: LatLngExpression[]): this {
      this.points = points;
      if (this.map) {
        this.map.onReady(() => {
          this.ensureLayer();
          const source = this.map!.raw.getSource(this.sourceId);
          if (source?.setData) source.setData(this.geoJson());
        });
      }
      return this;
    }

    getBounds(): LatLngBounds { return new LatLngBounds(this.points); }

    remove(): this {
      this.removed = true;
      if (this.map) {
        const raw = this.map.raw;
        if (raw.getLayer(this.layerId)) raw.removeLayer(this.layerId);
        if (raw.getSource(this.sourceId)) raw.removeSource(this.sourceId);
      }
      return this;
    }

    bringToFront(): this {
      if (this.map?.raw.getLayer(this.layerId)) this.map.raw.moveLayer(this.layerId);
      return this;
    }
  }

  export function map(container: string, options: any = {}): Map {
    return new Map(container, options);
  }

  export function tileLayer(url: string, options: any = {}): TileLayer {
    return new TileLayer(url, options);
  }

  export function circleMarker(latLng: LatLngExpression, options: CircleMarkerOptions = {}): CircleMarker {
    return new CircleMarker(latLng, options);
  }

  export function polyline(points: LatLngExpression[], options: PolylineOptions = {}): Polyline {
    return new Polyline(points, options);
  }

  export function latLng(lat: number, lng: number): LatLngExpression {
    return [lat, lng];
  }

  export function latLngBounds(points: LatLngExpression[]): LatLngBounds {
    return new LatLngBounds(points);
  }

  export const control = {
    zoom: (_options: any = {}) => ({ addTo: (_map: Map) => undefined })
  };
}
