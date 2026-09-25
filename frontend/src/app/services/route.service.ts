import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment.generated';

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface WalkingRoute {
  distanceMeters: number;
  durationSeconds: number;
  points: RoutePoint[];
}

@Injectable({ providedIn: 'root' })
export class RouteService {
  private readonly api = `${environment.apiBaseUrl}/api/route`;

  constructor(private http: HttpClient) {}

  walking(fromLat: number, fromLng: number, toLat: number, toLng: number) {
    const params = new HttpParams()
      .set('fromLat', fromLat)
      .set('fromLng', fromLng)
      .set('toLat', toLat)
      .set('toLng', toLng);

    return this.http.get<WalkingRoute>(`${this.api}/walking`, { params });
  }
}
