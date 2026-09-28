import { environment } from '../../environments/environment.generated';

declare const google: any;

type GoogleMap = any;
type GoogleMarker = any;
type GooglePolyline = any;

let googleMapsPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (typeof (window as any).google?.maps?.Map === 'function') return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise<void>((resolve, reject) => {
    const apiKey = environment.googleMapsApiKey;
    if (!apiKey) {
      reject(new Error('GOOGLE_MAPS_API_KEY is not configured.'));
      return;
    }

    const callbackName = `__findmeGoogleMapsReady_${Date.now()}`;
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.onerror = () => {
      delete (window as any)[callbackName];
      reject(new Error('Google Maps JavaScript API could not be loaded.'));
    };
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

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

  interface ViewOptions { animate?: boolean; }

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

  function toLiteral(value: LatLngExpression): { lat: number; lng: number } {
    return Array.isArray(value) ? { lat: value[0], lng: value[1] } : value;
  }

  let zSequence = 100;

  export class LatLngBounds {
    private points: LatLngExpression[] = [];
    constructor(points: LatLngExpression[] = []) { points.forEach(p => this.extend(p)); }
    extend(point: LatLngExpression): this { this.points.push(point); return this; }
    values(): LatLngExpression[] { return [...this.points]; }
  }

  export class Map {
    raw?: GoogleMap;
    private ready = false;
    private callbacks: Array<() => void> = [];
    private initialCenter: LatLngExpression;
    private initialZoom: number;

    constructor(private containerId: string, options: any = {}) {
      this.initialCenter = options.center ?? [20.5937, 78.9629];
      this.initialZoom = options.zoom ?? 5;
      void this.initialize();
    }

    private async initialize(): Promise<void> {
      const container = document.getElementById(this.containerId);
      if (!container) return;
      try {
        await loadGoogleMaps();
        this.raw = new google.maps.Map(container, {
          center: toLiteral(this.initialCenter),
          zoom: this.initialZoom,
          renderingType: google.maps.RenderingType?.VECTOR,
          tiltInteractionEnabled: true,
          headingInteractionEnabled: true,
          gestureHandling: 'greedy',
          isFractionalZoomEnabled: true,
          mapTypeId: google.maps.MapTypeId.ROADMAP,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          rotateControl: true,
          scaleControl: false,
          clickableIcons: true,
          backgroundColor: '#e8edf3',
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
          rotateControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM }
        });
        this.ready = true;
        const callbacks = [...this.callbacks];
        this.callbacks.length = 0;
        callbacks.forEach(cb => cb());
      } catch (error) {
        container.innerHTML = `<div style="display:grid;place-items:center;height:100%;padding:24px;text-align:center;color:#475467;background:#eef2f6;font:600 14px system-ui">${error instanceof Error ? error.message : 'Google Maps failed to load.'}</div>`;
      }
    }

    onReady(callback: () => void): void {
      if (this.ready && this.raw) callback();
      else this.callbacks.push(callback);
    }

    setBaseMode(mode: 'street' | 'satellite'): void {
      this.onReady(() => this.raw?.setMapTypeId(mode === 'satellite' ? google.maps.MapTypeId.HYBRID : google.maps.MapTypeId.ROADMAP));
    }

    setView(center: LatLngExpression, zoom?: number, options: ViewOptions = {}): this {
      this.onReady(() => {
        const literal = toLiteral(center);
        if (options.animate) this.raw?.panTo(literal);
        else this.raw?.setCenter(literal);
        if (zoom != null) this.raw?.setZoom(zoom);
      });
      return this;
    }

    fitBounds(bounds: LatLngBounds, options: FitOptions = {}): this {
      this.onReady(() => {
        if (!this.raw) return;
        const gmBounds = new google.maps.LatLngBounds();
        bounds.values().forEach(point => gmBounds.extend(toLiteral(point)));
        const padding = this.normalizePadding(options);
        this.raw.fitBounds(gmBounds, padding);
        if (options.maxZoom != null) {
          google.maps.event.addListenerOnce(this.raw, 'idle', () => {
            const current = this.raw?.getZoom?.();
            if (typeof current === 'number' && current > options.maxZoom!) this.raw?.setZoom(options.maxZoom);
          });
        }
      });
      return this;
    }

    private normalizePadding(options: FitOptions): any {
      if (typeof options.padding === 'number') return options.padding;
      if (Array.isArray(options.padding)) return { top: options.padding[1], right: options.padding[0], bottom: options.padding[1], left: options.padding[0] };
      if (options.paddingTopLeft || options.paddingBottomRight) {
        const tl = options.paddingTopLeft ?? [0, 0];
        const br = options.paddingBottomRight ?? [0, 0];
        return { top: tl[1], left: tl[0], right: br[0], bottom: br[1] };
      }
      return 40;
    }

    getZoom(): number { return this.raw?.getZoom?.() ?? this.initialZoom; }
    getBearing(): number { return this.raw?.getHeading?.() ?? 0; }
    getPitch(): number { return this.raw?.getTilt?.() ?? 0; }
    invalidateSize(_options?: any): void { this.onReady(() => google.maps.event.trigger(this.raw, 'resize')); }
    resize(): void { this.invalidateSize(); }
    removeLayer(layer: TileLayer | Polyline): this { if (layer instanceof Polyline) layer.remove(); return this; }
  }

  export class TileLayer {
    private kind: 'street' | 'satellite' | 'labels';
    constructor(private url: string, _options: any = {}) {
      this.kind = url.includes('hybrid') || url.includes('satellite') || url.includes('World_Imagery') ? 'satellite'
        : url.includes('labels') || url.includes('World_Boundaries') ? 'labels'
        : 'street';
    }
    addTo(map: Map): this {
      if (this.kind === 'street') map.setBaseMode('street');
      if (this.kind === 'satellite') map.setBaseMode('satellite');
      return this;
    }
    remove(): this { return this; }
  }

  export class CircleMarker {
    private marker?: GoogleMarker;
    private map?: Map;
    private latLng: LatLngExpression;
    private tooltipText = '';
    private removed = false;

    constructor(latLng: LatLngExpression, private options: CircleMarkerOptions = {}) { this.latLng = latLng; }

    addTo(map: Map): this {
      this.map = map;
      this.removed = false;
      map.onReady(() => this.ensureMarker());
      return this;
    }

    private ensureMarker(): void {
      if (!this.map?.raw || this.marker || this.removed) return;
      this.marker = new google.maps.Marker({
        map: this.map.raw,
        position: toLiteral(this.latLng),
        zIndex: ++zSequence,
        optimized: true,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: this.options.radius ?? 10,
          fillColor: this.options.fillColor ?? '#2563eb',
          fillOpacity: this.options.fillOpacity ?? 1,
          strokeColor: this.options.color ?? '#ffffff',
          strokeWeight: this.options.weight ?? 3
        },
        label: this.buildLabel()
      });
    }

    private buildLabel(): any {
      return this.tooltipText ? {
        text: this.tooltipText,
        color: '#1f2937',
        fontSize: '11px',
        fontWeight: '800',
        className: 'findme-google-marker-label'
      } : undefined;
    }

    setLatLng(latLng: LatLngExpression): this {
      this.latLng = latLng;
      this.marker?.setPosition(toLiteral(latLng));
      return this;
    }

    bindTooltip(text: string, _options: TooltipOptions = {}): this {
      this.tooltipText = text;
      this.marker?.setLabel(this.buildLabel());
      return this;
    }

    remove(): this { this.removed = true; this.marker?.setMap(null); this.marker = undefined; return this; }
    bringToFront(): this { this.marker?.setZIndex(++zSequence); return this; }
  }

  export class Polyline {
    private map?: Map;
    private line?: GooglePolyline;
    private points: LatLngExpression[];
    private removed = false;

    constructor(points: LatLngExpression[], private options: PolylineOptions = {}) { this.points = points; }

    addTo(map: Map): this {
      this.map = map;
      this.removed = false;
      map.onReady(() => this.ensureLine());
      return this;
    }

    private ensureLine(): void {
      if (!this.map?.raw || this.line || this.removed) return;
      const dashed = !!this.options.dashArray;
      const lineSymbol = dashed ? { path: 'M 0,-1 0,1', strokeOpacity: this.options.opacity ?? 1, scale: 2 } : undefined;
      this.line = new google.maps.Polyline({
        map: this.map.raw,
        path: this.points.map(toLiteral),
        geodesic: false,
        clickable: this.options.interactive ?? false,
        strokeColor: this.options.color ?? '#4285f4',
        strokeWeight: this.options.weight ?? 5,
        strokeOpacity: dashed ? 0 : (this.options.opacity ?? 1),
        icons: dashed ? [{ icon: lineSymbol, offset: '0', repeat: '14px' }] : undefined,
        zIndex: ++zSequence
      });
    }

    setLatLngs(points: LatLngExpression[]): this {
      this.points = points;
      this.line?.setPath(points.map(toLiteral));
      return this;
    }

    getBounds(): LatLngBounds { return new LatLngBounds(this.points); }
    remove(): this { this.removed = true; this.line?.setMap(null); this.line = undefined; return this; }
    bringToFront(): this { this.line?.setOptions({ zIndex: ++zSequence }); return this; }
  }

  export function map(container: string, options: any = {}): Map { return new Map(container, options); }
  export function tileLayer(url: string, options: any = {}): TileLayer { return new TileLayer(url, options); }
  export function circleMarker(latLng: LatLngExpression, options: CircleMarkerOptions = {}): CircleMarker { return new CircleMarker(latLng, options); }
  export function polyline(points: LatLngExpression[], options: PolylineOptions = {}): Polyline { return new Polyline(points, options); }
  export function latLng(lat: number, lng: number): LatLngExpression { return [lat, lng]; }
  export function latLngBounds(points: LatLngExpression[]): LatLngBounds { return new LatLngBounds(points); }
  export const control = { zoom: (_options: any = {}) => ({ addTo: (_map: Map) => undefined }) };
}
