import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.generated';

export interface SavedParkingLocation {
  deviceId: string;
  latitude: number;
  longitude: number;
  savedAtUtc?: string;
}

@Injectable({ providedIn: 'root' })
export class ParkingService {
  private readonly api = `${environment.apiBaseUrl}/api/parking`;

  constructor(private http: HttpClient) {}

  save(payload: { deviceId: string; latitude: number; longitude: number }) {
    return this.http.post<SavedParkingLocation>(`${this.api}/save`, payload);
  }

  get(deviceId: string) {
    return this.http.get<SavedParkingLocation>(`${this.api}/${deviceId}`);
  }

  clear(deviceId: string) {
    return this.http.delete<void>(`${this.api}/${deviceId}`);
  }
}
