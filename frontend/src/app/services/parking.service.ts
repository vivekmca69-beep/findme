import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.generated';

@Injectable({ providedIn: 'root' })
export class ParkingService {
  private readonly api = `${environment.apiBaseUrl}/api/parking`;

  constructor(private http: HttpClient) {}

  save(payload: { deviceId: string; latitude: number; longitude: number }) {
    return this.http.post(`${this.api}/save`, payload);
  }

  get(deviceId: string) {
    return this.http.get<any>(`${this.api}/${deviceId}`);
  }
}
