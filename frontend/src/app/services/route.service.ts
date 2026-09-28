import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment.generated';

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  type?: number;
  maneuver?: string;
}

export type RoutePreferenceMode = 'car' | 'two_wheeler' | 'bicycle' | 'walking';

export interface WalkingRoute {
  mode?: RoutePreferenceMode;
  profile?: string;
  provider?: string;
  distanceMeters: number;
  durationSeconds: number;
  points: RoutePoint[];
  steps: RouteStep[];
}

@Injectable({ providedIn: 'root' })
export class RouteService {
  private readonly api = `${environment.apiBaseUrl}/api/route`;

  constructor(private http: HttpClient) {}

  preferred(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    mode: RoutePreferenceMode = 'car'
  ) {
    const params = new HttpParams()
      .set('fromLat', fromLat)
      .set('fromLng', fromLng)
      .set('toLat', toLat)
      .set('toLng', toLng)
      .set('mode', mode);

    return this.http.get<WalkingRoute>(`${this.api}/preferred`, { params });
  }

  // Kept as a convenience for any future explicitly pedestrian-only screen.
  walking(fromLat: number, fromLng: number, toLat: number, toLng: number) {
    return this.preferred(fromLat, fromLng, toLat, toLng, 'walking');
  }
}
