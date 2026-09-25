import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParkingService } from './services/parking.service';
import { RouteService, WalkingRoute } from './services/route.service';
import {
  FriendLocationUpdate,
  FriendParticipantState,
  FriendService,
  FriendSessionState
} from './services/friend.service';
import * as L from 'leaflet';

interface ParticipantVm extends FriendParticipantState {
  distanceText?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  private map?: L.Map;
  private currentMarker?: L.CircleMarker;
  private vehicleMarker?: L.CircleMarker;
  private routeLine?: L.Polyline;
  private fallbackLine?: L.Polyline;
  private hostWalkingRouteLine?: L.Polyline;
  private locationWatchId?: number;
  private latestOwnLocation?: { latitude: number; longitude: number };
  private participantMarkers = new Map<string, L.CircleMarker>();
  private participantLines = new Map<string, L.Polyline>();
  private participantState = new Map<string, ParticipantVm>();
  private hostRouteInFlight = false;
  private lastHostRouteAt = 0;
  private lastHostOrigin?: { latitude: number; longitude: number };
  private lastHostTarget?: { latitude: number; longitude: number };
  private readonly activeSessionStorageKey = 'findme-active-session';

  status = 'Ready';
  deviceId = this.getDeviceId();
  distanceText = '';
  durationText = '';
  routeMode = '';

  displayName = '';
  joinCode = '';
  activeSessionCode = '';
  participantCount = 0;
  maxParticipants = 10;
  hostDeviceId = '';
  isSharing = false;
  participants: ParticipantVm[] = [];
  hostWalkingDistanceText = '';
  hostWalkingDurationText = '';
  hostRouteMode = '';

  constructor(
    private parking: ParkingService,
    private routes: RouteService,
    private friends: FriendService
  ) {}

  get isHost(): boolean {
    return !!this.hostDeviceId && this.hostDeviceId === this.deviceId;
  }

  get hostParticipant(): ParticipantVm | undefined {
    return this.participants.find(p => p.deviceId === this.hostDeviceId);
  }

  get otherParticipants(): ParticipantVm[] {
    return this.participants.filter(p => p.deviceId !== this.deviceId);
  }

  ngOnInit(): void {
    this.restoreSavedSession();
  }

  ngOnDestroy(): void {
    this.stopLocationWatch();
    void this.friends.disconnect();
  }

  saveVehicle(): void {
    this.status = 'Getting your current location...';
    this.clearRouteInfo();
    this.getCurrentPosition().then(pos => {
      const payload = { deviceId: this.deviceId, latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      this.parking.save(payload).subscribe({
        next: () => { this.status = 'Vehicle location saved.'; this.showSavedVehicle(payload.latitude, payload.longitude); },
        error: () => this.status = 'Could not save vehicle location.'
      });
    }).catch(err => this.status = String(err));
  }

  findVehicle(): void {
    this.status = 'Finding your vehicle...';
    this.clearRouteInfo();
    Promise.all([
      this.getCurrentPosition(),
      new Promise<any>((resolve, reject) => this.parking.get(this.deviceId).subscribe({ next: resolve, error: reject }))
    ]).then(([current, vehicle]) => {
      const currentLat = current.coords.latitude;
      const currentLng = current.coords.longitude;
      this.showEndpoints(currentLat, currentLng, vehicle.latitude, vehicle.longitude);
      this.status = 'Calculating walking route...';
      this.routes.walking(currentLat, currentLng, vehicle.latitude, vehicle.longitude).subscribe({
        next: route => this.showWalkingRoute(route),
        error: () => {
          this.showFallbackLine(currentLat, currentLng, vehicle.latitude, vehicle.longitude);
          this.status = 'Vehicle found. Direct line shown because walking route is unavailable.';
          this.routeMode = 'Direct-line fallback';
        }
      });
    }).catch(() => this.status = 'Could not find a saved vehicle location. Save it first.');
  }

  createFriendSession(): void {
    const name = this.normalizedName('Host');
    this.status = 'Creating group session...';
    this.friends.create(this.deviceId, name).subscribe({
      next: async result => {
        this.activeSessionCode = result.sessionCode;
        this.joinCode = result.sessionCode;
        this.hostDeviceId = result.hostDeviceId;
        this.maxParticipants = result.maxParticipants;
        this.displayName = name;
        this.saveActiveSession(result.sessionCode, name);
        try {
          await this.startFriendSharing();
          this.status = `Session ${result.sessionCode} created. You are the host.`;
        } catch (error) {
          this.status = this.errorMessage(error, 'Could not start live sharing.');
        }
      },
      error: () => this.status = 'Could not create group session.'
    });
  }

  joinFriendSession(): void {
    const code = this.joinCode.trim();
    if (!/^\d{6}$/.test(code)) {
      this.status = 'Enter a valid 6-digit session code.';
      return;
    }
    const name = this.normalizedName('Guest');
    this.status = 'Joining group session...';
    this.friends.join(code, this.deviceId, name).subscribe({
      next: async result => {
        this.activeSessionCode = result.sessionCode;
        this.hostDeviceId = result.hostDeviceId;
        this.maxParticipants = result.maxParticipants;
        this.displayName = name;
        this.saveActiveSession(result.sessionCode, name);
        try {
          await this.startFriendSharing();
          this.status = `Joined session ${result.sessionCode}.`;
        } catch (error) {
          this.status = this.errorMessage(error, 'Could not start live sharing.');
        }
      },
      error: err => this.status = err?.error?.message ?? 'Could not join this session.'
    });
  }

  async stopSharing(): Promise<void> {
    this.stopLocationWatch();
    const code = this.activeSessionCode;
    this.clearActiveSession();
    if (code) {
      try { await this.friends.leave(code, this.deviceId); }
      catch { await this.friends.disconnect(); }
    }
    const wasHost = this.isHost;
    this.resetGroupState();
    this.status = wasHost ? 'Session closed.' : 'Location sharing stopped.';
  }

  private async startFriendSharing(): Promise<void> {
    if (!this.activeSessionCode) throw new Error('Missing session code.');
    await this.friends.connect(
      this.activeSessionCode,
      this.deviceId,
      update => this.handleParticipantLocation(update),
      state => this.applySessionState(state),
      () => {
        this.clearActiveSession();
        this.stopLocationWatch();
        this.resetGroupState();
        this.status = 'The host ended this session.';
      }
    );

    const firstPosition = await this.getCurrentPosition();
    const latitude = firstPosition.coords.latitude;
    const longitude = firstPosition.coords.longitude;
    this.latestOwnLocation = { latitude, longitude };
    this.showOwnLocation(latitude, longitude);
    await this.friends.sendLocation(this.activeSessionCode, this.deviceId, latitude, longitude);
    this.isSharing = true;
    this.startLocationWatch();
  }

  private applySessionState(state: FriendSessionState): void {
    this.hostDeviceId = state.hostDeviceId;
    this.participantCount = state.participantCount;
    this.maxParticipants = state.maxParticipants;

    const incomingIds = new Set(state.participants.map(p => p.deviceId));
    for (const id of [...this.participantState.keys()]) {
      if (!incomingIds.has(id)) {
        this.participantState.delete(id);
        this.participantMarkers.get(id)?.remove();
        this.participantMarkers.delete(id);
        this.participantLines.get(id)?.remove();
        this.participantLines.delete(id);
      }
    }

    for (const participant of state.participants) {
      const existing = this.participantState.get(participant.deviceId) ?? participant;
      this.participantState.set(participant.deviceId, { ...existing, ...participant });
      if (participant.latitude != null && participant.longitude != null) {
        this.renderParticipant(participant.deviceId);
      }
    }
    this.refreshParticipantList();
    this.redrawHostConnectors();
  }

  private handleParticipantLocation(update: FriendLocationUpdate): void {
    const previous = this.participantState.get(update.deviceId);
    this.participantState.set(update.deviceId, { ...previous, ...update });
    if (update.deviceId === this.deviceId) {
      this.latestOwnLocation = { latitude: update.latitude, longitude: update.longitude };
      this.showOwnLocation(update.latitude, update.longitude);
    } else {
      this.renderParticipant(update.deviceId);
    }
    this.refreshParticipantList();
    this.redrawHostConnectors();
    this.refreshOwnWalkingRouteToHostIfNeeded();
  }

  private startLocationWatch(): void {
    this.stopLocationWatch();
    if (!navigator.geolocation) { this.status = 'Geolocation is not supported by this browser.'; return; }
    this.locationWatchId = navigator.geolocation.watchPosition(
      position => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        this.latestOwnLocation = { latitude, longitude };
        this.showOwnLocation(latitude, longitude);
        const own = this.participantState.get(this.deviceId);
        if (own) this.participantState.set(this.deviceId, { ...own, latitude, longitude });
        void this.friends.sendLocation(this.activeSessionCode, this.deviceId, latitude, longitude);
        this.refreshParticipantList();
        this.redrawHostConnectors();
        this.refreshOwnWalkingRouteToHostIfNeeded();
      },
      error => this.status = error.code === error.PERMISSION_DENIED
        ? 'Location permission is required for live sharing.'
        : 'Could not update your live location.',
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
    );
  }

  private stopLocationWatch(): void {
    if (this.locationWatchId !== undefined) {
      navigator.geolocation.clearWatch(this.locationWatchId);
      this.locationWatchId = undefined;
    }
  }

  private renderParticipant(deviceId: string): void {
    if (deviceId === this.deviceId) return;
    const p = this.participantState.get(deviceId);
    if (!p || p.latitude == null || p.longitude == null) return;
    this.initMap(p.latitude, p.longitude);
    let marker = this.participantMarkers.get(deviceId);
    if (!marker) {
      marker = L.circleMarker([p.latitude, p.longitude], { radius: p.isHost ? 11 : 9, weight: 3, fillOpacity: 1 }).addTo(this.map!);
      this.participantMarkers.set(deviceId, marker);
    } else marker.setLatLng([p.latitude, p.longitude]);
    marker.bindTooltip(`${p.isHost ? '⭐ ' : '👤 '}${p.displayName}${p.isHost ? ' (Host)' : ''}`, {
      permanent: true, direction: 'top', offset: [0, -8]
    });
  }

  private redrawHostConnectors(): void {
    if (!this.map || !this.hostDeviceId) return;
    const host = this.participantState.get(this.hostDeviceId);
    if (!host || host.latitude == null || host.longitude == null) return;

    const validIds = new Set<string>();
    for (const p of this.participantState.values()) {
      if (p.deviceId === this.hostDeviceId || p.latitude == null || p.longitude == null) continue;
      validIds.add(p.deviceId);
      let line = this.participantLines.get(p.deviceId);
      const points: L.LatLngExpression[] = [[host.latitude, host.longitude], [p.latitude, p.longitude]];
      if (!line) {
        line = L.polyline(points, { weight: 3, dashArray: '7, 9', opacity: 0.65 }).addTo(this.map);
        this.participantLines.set(p.deviceId, line);
      } else line.setLatLngs(points);
    }
    for (const [id, line] of [...this.participantLines.entries()]) {
      if (!validIds.has(id)) { line.remove(); this.participantLines.delete(id); }
    }
  }

  private refreshParticipantList(): void {
    this.participants = [...this.participantState.values()]
      .map(p => ({ ...p, distanceText: this.distanceFromMe(p) }))
      .sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.displayName.localeCompare(b.displayName));
  }

  private distanceFromMe(p: ParticipantVm): string {
    if (!this.latestOwnLocation || p.latitude == null || p.longitude == null || p.deviceId === this.deviceId) return '';
    return this.formatDistance(this.haversineMeters(
      this.latestOwnLocation.latitude, this.latestOwnLocation.longitude, p.latitude, p.longitude
    ));
  }

  private refreshOwnWalkingRouteToHostIfNeeded(): void {
    if (this.isHost || this.hostRouteInFlight || !this.latestOwnLocation) return;
    const host = this.participantState.get(this.hostDeviceId);
    if (!host || host.latitude == null || host.longitude == null) return;

    const now = Date.now();
    const originMoved = this.lastHostOrigin
      ? this.haversineMeters(this.lastHostOrigin.latitude, this.lastHostOrigin.longitude, this.latestOwnLocation.latitude, this.latestOwnLocation.longitude)
      : Infinity;
    const targetMoved = this.lastHostTarget
      ? this.haversineMeters(this.lastHostTarget.latitude, this.lastHostTarget.longitude, host.latitude, host.longitude)
      : Infinity;
    if (this.lastHostRouteAt && (now - this.lastHostRouteAt < 10000 || (originMoved < 20 && targetMoved < 20))) return;

    this.hostRouteInFlight = true;
    this.lastHostRouteAt = now;
    this.lastHostOrigin = { ...this.latestOwnLocation };
    this.lastHostTarget = { latitude: host.latitude, longitude: host.longitude };
    this.routes.walking(this.latestOwnLocation.latitude, this.latestOwnLocation.longitude, host.latitude, host.longitude).subscribe({
      next: route => {
        this.hostRouteInFlight = false;
        if (!this.map || !route.points?.length) return;
        this.hostWalkingRouteLine?.remove();
        this.hostWalkingRouteLine = L.polyline(route.points.map(x => L.latLng(x.latitude, x.longitude)), { weight: 6, opacity: 0.9 }).addTo(this.map);
        this.hostWalkingDistanceText = this.formatDistance(route.distanceMeters);
        this.hostWalkingDurationText = this.formatDuration(route.durationSeconds);
        this.hostRouteMode = 'Walking route to host';
      },
      error: () => {
        this.hostRouteInFlight = false;
        this.hostWalkingDistanceText = '';
        this.hostWalkingDurationText = '';
        this.hostRouteMode = 'Host connector';
      }
    });
  }

  private showOwnLocation(latitude: number, longitude: number): void {
    this.initMap(latitude, longitude);
    if (!this.currentMarker) {
      this.currentMarker = L.circleMarker([latitude, longitude], { radius: 10, weight: 3, fillOpacity: 1 }).addTo(this.map!)
        .bindTooltip(this.isHost ? '⭐ You (Host)' : 'You', { permanent: true, direction: 'top', offset: [0, -8] });
    } else {
      this.currentMarker.setLatLng([latitude, longitude]);
      this.currentMarker.bindTooltip(this.isHost ? '⭐ You (Host)' : 'You', { permanent: true, direction: 'top', offset: [0, -8] });
    }
  }

  private resetGroupState(): void {
    const wasHost = this.isHost;
    this.isSharing = false;
    this.participantCount = 0;
    this.hostDeviceId = '';
    this.activeSessionCode = '';
    this.participants = [];
    this.participantState.clear();
    for (const marker of this.participantMarkers.values()) marker.remove();
    for (const line of this.participantLines.values()) line.remove();
    this.participantMarkers.clear();
    this.participantLines.clear();
    this.hostWalkingRouteLine?.remove();
    this.hostWalkingRouteLine = undefined;
    this.hostWalkingDistanceText = '';
    this.hostWalkingDurationText = '';
    this.hostRouteMode = '';
    this.hostRouteInFlight = false;
    this.lastHostRouteAt = 0;
    this.lastHostOrigin = undefined;
    this.lastHostTarget = undefined;
    if (wasHost) this.status = 'Session closed.';
  }

  private restoreSavedSession(): void {
    const saved = this.readActiveSession();
    if (!saved) return;

    this.status = 'Restoring your active session...';
    this.friends.restore(saved.sessionCode, this.deviceId).subscribe({
      next: async result => {
        this.activeSessionCode = result.sessionCode;
        this.joinCode = result.sessionCode;
        this.hostDeviceId = result.hostDeviceId;
        this.maxParticipants = result.maxParticipants;
        this.displayName = result.displayName || saved.displayName || '';
        this.saveActiveSession(result.sessionCode, this.displayName);
        try {
          await this.startFriendSharing();
          this.status = this.isHost
            ? `Session ${result.sessionCode} restored. You are the host.`
            : `Session ${result.sessionCode} restored.`;
        } catch (error) {
          this.status = this.errorMessage(error, 'Could not restore live sharing.');
        }
      },
      error: () => {
        this.clearActiveSession();
        this.resetGroupState();
        this.status = 'Your previous session is no longer active.';
      }
    });
  }

  private saveActiveSession(sessionCode: string, displayName: string): void {
    localStorage.setItem(this.activeSessionStorageKey, JSON.stringify({ sessionCode, displayName }));
  }

  private readActiveSession(): { sessionCode: string; displayName: string } | null {
    const raw = localStorage.getItem(this.activeSessionStorageKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.sessionCode !== 'string' || !/^\d{6}$/.test(parsed.sessionCode)) return null;
      return { sessionCode: parsed.sessionCode, displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '' };
    } catch {
      return null;
    }
  }

  private clearActiveSession(): void {
    localStorage.removeItem(this.activeSessionStorageKey);
  }

  private getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject('Geolocation is not supported by this browser.'); return; }
      navigator.geolocation.getCurrentPosition(resolve, error => reject(
        error.code === error.PERMISSION_DENIED ? 'Location permission is required.' : 'Could not get your current location.'
      ), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    });
  }

  private initMap(lat: number, lng: number): void {
    if (!this.map) {
      this.map = L.map('map').setView([lat, lng], 17);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
      }).addTo(this.map);
    }
  }

  private showSavedVehicle(lat: number, lng: number): void {
    this.initMap(lat, lng); this.clearVehicleMapObjects();
    this.vehicleMarker = L.circleMarker([lat, lng], { radius: 9, weight: 3, fillOpacity: 1 }).addTo(this.map!)
      .bindTooltip('🚗 Vehicle', { permanent: true, direction: 'top', offset: [0, -8] });
    this.map!.setView([lat, lng], 18);
  }

  private showEndpoints(curLat: number, curLng: number, vehLat: number, vehLng: number): void {
    this.initMap(curLat, curLng); this.clearVehicleMapObjects();
    this.currentMarker = L.circleMarker([curLat, curLng], { radius: 9, weight: 3, fillOpacity: 1 }).addTo(this.map!)
      .bindTooltip('You', { permanent: true, direction: 'top', offset: [0, -8] });
    this.vehicleMarker = L.circleMarker([vehLat, vehLng], { radius: 9, weight: 3, fillOpacity: 1 }).addTo(this.map!)
      .bindTooltip('🚗 Vehicle', { permanent: true, direction: 'top', offset: [0, -8] });
    this.map!.fitBounds(L.latLngBounds([[curLat, curLng], [vehLat, vehLng]]), { padding: [55, 55], maxZoom: 18 });
  }

  private showWalkingRoute(route: WalkingRoute): void {
    if (!this.map || !route.points?.length) { this.status = 'A walking route could not be calculated.'; return; }
    this.routeLine?.remove(); this.fallbackLine?.remove();
    this.routeLine = L.polyline(route.points.map(p => L.latLng(p.latitude, p.longitude)), { weight: 6, opacity: 0.85 }).addTo(this.map);
    this.map.fitBounds(this.routeLine.getBounds(), { padding: [55, 55] });
    this.distanceText = this.formatDistance(route.distanceMeters);
    this.durationText = this.formatDuration(route.durationSeconds);
    this.routeMode = 'Walking route';
    this.status = 'Walking route to your vehicle is ready.';
  }

  private showFallbackLine(curLat: number, curLng: number, vehLat: number, vehLng: number): void {
    if (!this.map) return;
    this.routeLine?.remove(); this.fallbackLine?.remove();
    this.fallbackLine = L.polyline([[curLat, curLng], [vehLat, vehLng]], { weight: 4, dashArray: '8, 10', opacity: 0.7 }).addTo(this.map);
  }

  private clearVehicleMapObjects(): void {
    this.currentMarker?.remove(); this.vehicleMarker?.remove(); this.routeLine?.remove(); this.fallbackLine?.remove();
    this.currentMarker = undefined; this.vehicleMarker = undefined; this.routeLine = undefined; this.fallbackLine = undefined;
  }

  private clearRouteInfo(): void { this.distanceText = ''; this.durationText = ''; this.routeMode = ''; }
  private normalizedName(fallback: string): string { const value = this.displayName.trim(); return value ? value.slice(0, 40) : fallback; }
  private formatDistance(meters: number): string { return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`; }
  private formatDuration(seconds: number): string {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60); const remaining = minutes % 60;
    return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
  }
  private haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const radius = 6371000; const toRad = (v: number) => v * Math.PI / 180;
    const dLat = toRad(lat2 - lat1); const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  private errorMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
  private getDeviceId(): string {
    const key = 'findme-device-id'; let id = localStorage.getItem(key);
    if (!id) { id = this.createDeviceId(); localStorage.setItem(key, id); }
    return id;
  }
  private createDeviceId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.floor(Math.random() * 16); const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
    });
  }
}
