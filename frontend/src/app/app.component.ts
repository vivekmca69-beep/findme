import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core';
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
import { L } from './map/maplibre-compat';

interface ParticipantVm extends FriendParticipantState {
  distanceText?: string;
  statusLabel?: string;
  statusClass?: 'live' | 'recent' | 'offline' | 'waiting';
  lastSeenText?: string;
}

type NavigationTarget = 'host' | 'meeting';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  private map?: L.Map;
  private streetLayer?: L.TileLayer;
  private satelliteLayer?: L.TileLayer;
  private satelliteLabelsLayer?: L.TileLayer;
  private currentMarker?: L.CircleMarker;
  private vehicleMarker?: L.CircleMarker;
  private meetingPointMarker?: L.CircleMarker;
  private routeLine?: L.Polyline;
  private fallbackLine?: L.Polyline;
  private vehicleRouteCasingLine?: L.Polyline;
  private vehicleNavigationWatchId?: number;
  private vehicleTarget?: { latitude: number; longitude: number };
  private vehicleRouteInFlight = false;
  private lastVehicleRouteAt = 0;
  private lastVehicleRouteOrigin?: { latitude: number; longitude: number };
  private hostWalkingRouteLine?: L.Polyline;
  private navigationRouteLine?: L.Polyline;
  private locationWatchId?: number;
  latestOwnLocation?: { latitude: number; longitude: number };
  private participantMarkers = new Map<string, L.CircleMarker>();
  private participantLines = new Map<string, L.Polyline>();
  private participantState = new Map<string, ParticipantVm>();
  private hostRouteInFlight = false;
  private lastHostRouteAt = 0;
  private lastHostOrigin?: { latitude: number; longitude: number };
  private lastHostTarget?: { latitude: number; longitude: number };
  private navigationRouteInFlight = false;
  private lastNavigationRouteAt = 0;
  private lastNavigationOrigin?: { latitude: number; longitude: number };
  private lastNavigationTarget?: { latitude: number; longitude: number };
  private participantStatusTimer?: number;
  private readonly activeSessionStorageKey = 'findme-active-session';
  private readonly orientationHandler = (event: DeviceOrientationEvent) => this.handleOrientation(event);

  status = 'Map ready';
  deviceId = this.getDeviceId();
  distanceText = '';
  durationText = '';
  routeMode = '';
  vehicleNavigationActive = false;

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

  meetingLatitude?: number;
  meetingLongitude?: number;
  meetingUpdatedAtUtc?: string;

  navigationActive = false;
  navigationTarget: NavigationTarget = 'host';
  navigationTargetName = 'Host';
  navigationInstruction = '';
  navigationDistanceText = '';
  navigationDurationText = '';
  navigationStepDistanceText = '';

  compassActive = false;
  compassHeading = 0;
  compassBearing = 0;
  compassRotation = 0;
  compassDistanceText = '';
  compassTargetName = '';

  isMapFullscreen = false;
  mapMode: 'street' | 'satellite' = 'street';
  private lastAutoFitParticipantCount = 0;
  private hasAutoFittedHostRoute = false;

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

  get hasMeetingPoint(): boolean {
    return this.meetingLatitude != null && this.meetingLongitude != null;
  }

  ngOnInit(): void {
    this.participantStatusTimer = window.setInterval(() => this.refreshParticipantList(), 5000);
    this.restoreSavedSession();
  }

  ngAfterViewInit(): void {
    // Always render a useful map immediately, even before the user starts GPS/session activity.
    window.setTimeout(() => {
      this.initMap(20.5937, 78.9629, 5);
      this.map?.invalidateSize();
    }, 0);
  }

  ngOnDestroy(): void {
    this.stopLocationWatch();
    this.stopVehicleNavigation(false);
    this.stopCompass();
    document.body.classList.remove('findme-map-fullscreen-open');
    if (this.participantStatusTimer !== undefined) window.clearInterval(this.participantStatusTimer);
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

    // Prevent duplicate GPS watchers/markers when Find vehicle is tapped repeatedly.
    this.stopVehicleNavigation(false);

    this.parking.get(this.deviceId).subscribe({
      next: vehicle => {
        this.vehicleTarget = { latitude: vehicle.latitude, longitude: vehicle.longitude };
        this.vehicleNavigationActive = true;
        this.status = 'Starting live walking navigation to your vehicle...';

        this.getCurrentPosition().then(current => {
          const currentLat = current.coords.latitude;
          const currentLng = current.coords.longitude;
          this.latestOwnLocation = { latitude: currentLat, longitude: currentLng };
          this.showEndpoints(currentLat, currentLng, vehicle.latitude, vehicle.longitude);
          this.refreshVehicleRoute(currentLat, currentLng, true);
          this.startVehicleLocationWatch();
        }).catch(err => {
          this.vehicleNavigationActive = false;
          this.status = String(err);
        });
      },
      error: () => this.status = 'Could not find a saved vehicle location. Save it first.'
    });
  }

  stopVehicleNavigation(updateStatus = true): void {
    if (this.vehicleNavigationWatchId !== undefined) {
      navigator.geolocation.clearWatch(this.vehicleNavigationWatchId);
      this.vehicleNavigationWatchId = undefined;
    }
    this.vehicleNavigationActive = false;
    this.vehicleRouteInFlight = false;
    this.lastVehicleRouteAt = 0;
    this.lastVehicleRouteOrigin = undefined;
    this.vehicleTarget = undefined;
    if (updateStatus) this.status = 'Vehicle navigation stopped.';
  }

  private startVehicleLocationWatch(): void {
    if (!navigator.geolocation || !this.vehicleTarget) return;
    if (this.vehicleNavigationWatchId !== undefined) {
      navigator.geolocation.clearWatch(this.vehicleNavigationWatchId);
    }

    this.vehicleNavigationWatchId = navigator.geolocation.watchPosition(
      position => {
        if (!this.vehicleNavigationActive || !this.vehicleTarget) return;
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        this.latestOwnLocation = { latitude, longitude };

        // Reuse the same marker instead of creating another dot.
        this.showOwnLocation(latitude, longitude);
        this.refreshVehicleRoute(latitude, longitude);

        // Navigation-style follow mode. The route itself is refreshed only when
        // enough movement has occurred, while the marker can move continuously.
        this.map?.setView([latitude, longitude], Math.max(this.map?.getZoom() ?? 18, 17), { animate: true });
      },
      error => {
        this.status = error.code === error.PERMISSION_DENIED
          ? 'Location permission is required for live vehicle navigation.'
          : 'Could not update your live vehicle-navigation location.';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
    );
  }

  private refreshVehicleRoute(latitude: number, longitude: number, force = false): void {
    if (!this.vehicleTarget || this.vehicleRouteInFlight) return;

    const now = Date.now();
    const moved = this.lastVehicleRouteOrigin
      ? this.haversineMeters(
          this.lastVehicleRouteOrigin.latitude,
          this.lastVehicleRouteOrigin.longitude,
          latitude,
          longitude
        )
      : Number.POSITIVE_INFINITY;

    // Re-route after ~8 m of movement and no more frequently than every 5 sec.
    if (!force && this.lastVehicleRouteAt && (now - this.lastVehicleRouteAt < 5000 || moved < 8)) return;

    this.vehicleRouteInFlight = true;
    this.lastVehicleRouteAt = now;
    this.lastVehicleRouteOrigin = { latitude, longitude };

    this.routes.walking(
      latitude,
      longitude,
      this.vehicleTarget.latitude,
      this.vehicleTarget.longitude
    ).subscribe({
      next: route => {
        this.vehicleRouteInFlight = false;
        if (!route.points || route.points.length < 2) {
          this.showFallbackLine(latitude, longitude, this.vehicleTarget!.latitude, this.vehicleTarget!.longitude);
          this.routeMode = 'Direct-line fallback';
          return;
        }
        this.showWalkingRoute(route, force);
      },
      error: () => {
        this.vehicleRouteInFlight = false;
        this.showFallbackLine(latitude, longitude, this.vehicleTarget!.latitude, this.vehicleTarget!.longitude);
        this.status = 'Walking route is temporarily unavailable. Direct line shown.';
        this.routeMode = 'Direct-line fallback';
      }
    });
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
    this.stopNavigation();
    this.stopCompass();
    const code = this.activeSessionCode;
    const wasHost = this.isHost;
    this.clearActiveSession();
    if (code) {
      try { await this.friends.leave(code, this.deviceId); }
      catch { await this.friends.disconnect(); }
    }
    this.resetGroupState();
    this.status = wasHost ? 'Session closed.' : 'Location sharing stopped.';
  }

  async createSmartMeetingPoint(): Promise<void> {
    if (!this.isHost || !this.activeSessionCode) return;
    const live = [...this.participantState.values()].filter(p => p.latitude != null && p.longitude != null);
    if (live.length < 2) {
      this.status = 'At least two live GPS positions are required for a meeting point.';
      return;
    }

    const latitude = live.reduce((sum, p) => sum + (p.latitude ?? 0), 0) / live.length;
    const longitude = live.reduce((sum, p) => sum + (p.longitude ?? 0), 0) / live.length;
    try {
      await this.friends.setMeetingPoint(this.activeSessionCode, this.deviceId, latitude, longitude);
      this.status = 'Balanced meeting point shared with the group.';
    } catch (error) {
      this.status = this.errorMessage(error, 'Could not set the meeting point.');
    }
  }

  startNavigation(target: NavigationTarget): void {
    if (!this.latestOwnLocation) {
      this.status = 'Waiting for your GPS location before starting navigation.';
      return;
    }
    if (!this.getTargetCoordinates(target)) {
      this.status = target === 'meeting' ? 'Create a meeting point first.' : 'Waiting for the host GPS.';
      return;
    }
    this.navigationTarget = target;
    this.navigationTargetName = target === 'meeting' ? 'Meeting point' : (this.hostParticipant?.displayName || 'Host');
    this.navigationActive = true;
    this.navigationInstruction = 'Calculating route…';
    this.lastNavigationRouteAt = 0;
    this.lastNavigationOrigin = undefined;
    this.lastNavigationTarget = undefined;
    this.refreshNavigationRouteIfNeeded(true);
    this.status = `Live navigation to ${this.navigationTargetName} started.`;
  }

  stopNavigation(): void {
    this.navigationActive = false;
    this.navigationInstruction = '';
    this.navigationDistanceText = '';
    this.navigationDurationText = '';
    this.navigationStepDistanceText = '';
    this.navigationRouteLine?.remove();
    this.navigationRouteLine = undefined;
    this.navigationRouteInFlight = false;
  }

  async toggleCompass(target: NavigationTarget): Promise<void> {
    if (this.compassActive && this.navigationTarget === target) {
      this.stopCompass();
      return;
    }
    if (!this.latestOwnLocation || !this.getTargetCoordinates(target)) {
      this.status = target === 'meeting' ? 'Meeting point or GPS is not ready.' : 'Host GPS is not ready.';
      return;
    }

    this.navigationTarget = target;
    this.compassTargetName = target === 'meeting' ? 'Meeting point' : (this.hostParticipant?.displayName || 'Host');

    const orientationCtor = DeviceOrientationEvent as any;
    if (typeof orientationCtor.requestPermission === 'function') {
      const permission = await orientationCtor.requestPermission();
      if (permission !== 'granted') {
        this.status = 'Compass permission was not granted.';
        return;
      }
    }

    this.stopCompass();
    window.addEventListener('deviceorientation', this.orientationHandler, true);
    this.compassActive = true;
    this.updateCompassTarget();
    this.status = `Compass pointing to ${this.compassTargetName}.`;
  }

  recenterOnMe(): void {
    if (this.latestOwnLocation) this.map?.setView([this.latestOwnLocation.latitude, this.latestOwnLocation.longitude], 18);
  }

  setMapMode(mode: 'street' | 'satellite'): void {
    if (!this.map || this.mapMode === mode) return;
    this.mapMode = mode;

    if (this.streetLayer) this.map.removeLayer(this.streetLayer);
    if (this.satelliteLayer) this.map.removeLayer(this.satelliteLayer);
    if (this.satelliteLabelsLayer) this.map.removeLayer(this.satelliteLabelsLayer);

    if (mode === 'satellite') {
      this.satelliteLayer?.addTo(this.map);
      this.satelliteLabelsLayer?.addTo(this.map);
    } else {
      this.streetLayer?.addTo(this.map);
    }
  }

  toggleMapFullscreen(): void {
    this.isMapFullscreen = !this.isMapFullscreen;
    document.body.classList.toggle('findme-map-fullscreen-open', this.isMapFullscreen);
    window.setTimeout(() => {
      this.map?.invalidateSize({ animate: true });
      if (this.isSharing) this.fitGroupBounds(true);
      else if (this.latestOwnLocation) this.map?.setView([this.latestOwnLocation.latitude, this.latestOwnLocation.longitude], 17, { animate: true });
    }, 180);
  }

  private fitGroupBounds(force = false): void {
    if (!this.map) return;
    const points: L.LatLngExpression[] = [];
    if (this.latestOwnLocation) points.push([this.latestOwnLocation.latitude, this.latestOwnLocation.longitude]);
    for (const p of this.participantState.values()) {
      if (p.latitude != null && p.longitude != null) points.push([p.latitude, p.longitude]);
    }
    if (this.hasMeetingPoint) points.push([this.meetingLatitude!, this.meetingLongitude!]);
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points);
    this.map.fitBounds(bounds, {
      paddingTopLeft: [42, 88],
      paddingBottomRight: [42, 72],
      maxZoom: 17,
      animate: true,
      duration: force ? 0.65 : 0.45
    });
  }

  private stopCompass(): void {
    window.removeEventListener('deviceorientation', this.orientationHandler, true);
    this.compassActive = false;
    this.compassDistanceText = '';
  }

  private handleOrientation(event: DeviceOrientationEvent): void {
    const anyEvent = event as any;
    let heading: number | null = typeof anyEvent.webkitCompassHeading === 'number'
      ? anyEvent.webkitCompassHeading
      : (typeof event.alpha === 'number' ? 360 - event.alpha : null);
    if (heading == null) return;
    heading = (heading + 360) % 360;
    this.compassHeading = heading;
    this.updateCompassTarget();
  }

  private updateCompassTarget(): void {
    if (!this.compassActive || !this.latestOwnLocation) return;
    const target = this.getTargetCoordinates(this.navigationTarget);
    if (!target) return;
    this.compassBearing = this.bearingDegrees(
      this.latestOwnLocation.latitude,
      this.latestOwnLocation.longitude,
      target.latitude,
      target.longitude
    );
    this.compassRotation = (this.compassBearing - this.compassHeading + 360) % 360;
    this.compassDistanceText = this.formatDistance(this.haversineMeters(
      this.latestOwnLocation.latitude,
      this.latestOwnLocation.longitude,
      target.latitude,
      target.longitude
    ));
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
        this.stopNavigation();
        this.stopCompass();
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
    const previousCount = this.participantCount;
    this.hostDeviceId = state.hostDeviceId;
    this.participantCount = state.participantCount;
    this.maxParticipants = state.maxParticipants;

    this.meetingLatitude = state.meetingLatitude ?? undefined;
    this.meetingLongitude = state.meetingLongitude ?? undefined;
    this.meetingUpdatedAtUtc = state.meetingUpdatedAtUtc ?? undefined;
    this.renderMeetingPoint();

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
      if (participant.latitude != null && participant.longitude != null) this.renderParticipant(participant.deviceId);
    }
    this.refreshParticipantList();
    this.redrawHostConnectors();
    this.refreshOwnWalkingRouteToHostIfNeeded();
    if (this.navigationActive) this.refreshNavigationRouteIfNeeded(true);
    this.updateCompassTarget();

    const joinedOrRestored = state.participantCount >= 2 && state.participantCount !== previousCount;
    if (joinedOrRestored || (this.lastAutoFitParticipantCount < 2 && state.participantCount >= 2)) {
      this.lastAutoFitParticipantCount = state.participantCount;
      window.setTimeout(() => this.fitGroupBounds(true), 220);
    } else {
      this.lastAutoFitParticipantCount = state.participantCount;
    }
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
    this.refreshNavigationRouteIfNeeded();
    this.updateCompassTarget();
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
        if (own) this.participantState.set(this.deviceId, { ...own, latitude, longitude, locationUpdatedAtUtc: new Date().toISOString() });
        void this.friends.sendLocation(this.activeSessionCode, this.deviceId, latitude, longitude);
        this.refreshParticipantList();
        this.redrawHostConnectors();
        this.refreshOwnWalkingRouteToHostIfNeeded();
        this.refreshNavigationRouteIfNeeded();
        this.updateCompassTarget();
        if (this.navigationActive) this.map?.setView([latitude, longitude], 18, { animate: true });
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
      marker = L.circleMarker([p.latitude, p.longitude], {
        radius: p.isHost ? 12 : 10,
        weight: 4,
        color: p.isHost ? '#ffffff' : '#ffffff',
        fillColor: p.isHost ? '#f59e0b' : '#7c3aed',
        fillOpacity: 1
      }).addTo(this.map!);
      this.participantMarkers.set(deviceId, marker);
    } else marker.setLatLng([p.latitude, p.longitude]);
    marker.bindTooltip(`${p.isHost ? '⭐ ' : '👤 '}${p.displayName}${p.isHost ? ' (Host)' : ''}`, {
      permanent: true, direction: 'top', offset: [0, -8]
    });
  }

  private renderMeetingPoint(): void {
    if (!this.map || !this.hasMeetingPoint) {
      this.meetingPointMarker?.remove();
      this.meetingPointMarker = undefined;
      return;
    }
    const lat = this.meetingLatitude!;
    const lng = this.meetingLongitude!;
    if (!this.meetingPointMarker) {
      this.meetingPointMarker = L.circleMarker([lat, lng], { radius: 13, weight: 4, color: '#ffffff', fillColor: '#10b981', fillOpacity: 1 }).addTo(this.map)
        .bindTooltip('📍 Meeting point', { permanent: true, direction: 'top', offset: [0, -8] });
    } else this.meetingPointMarker.setLatLng([lat, lng]);
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
        line = L.polyline(points, { color: '#64748b', weight: 3, dashArray: '7, 9', opacity: 0.72 }).addTo(this.map);
        this.participantLines.set(p.deviceId, line);
      } else line.setLatLngs(points);
    }
    for (const [id, line] of [...this.participantLines.entries()]) {
      if (!validIds.has(id)) { line.remove(); this.participantLines.delete(id); }
    }
  }

  private refreshParticipantList(): void {
    const now = Date.now();
    this.participants = [...this.participantState.values()]
      .map(p => {
        const status = this.participantStatus(p, now);
        return { ...p, distanceText: this.distanceFromMe(p), ...status };
      })
      .sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.displayName.localeCompare(b.displayName));
  }

  private participantStatus(p: ParticipantVm, now: number): Pick<ParticipantVm, 'statusLabel' | 'statusClass' | 'lastSeenText'> {
    if (p.latitude == null || p.longitude == null || !p.locationUpdatedAtUtc) {
      return { statusLabel: 'Waiting for GPS', statusClass: 'waiting', lastSeenText: 'No location yet' };
    }
    const ageSeconds = Math.max(0, Math.floor((now - Date.parse(p.locationUpdatedAtUtc)) / 1000));
    if (ageSeconds <= 15) return { statusLabel: 'Live', statusClass: 'live', lastSeenText: 'Now' };
    if (ageSeconds <= 60) return { statusLabel: 'Recent', statusClass: 'recent', lastSeenText: `${ageSeconds}s ago` };
    const minutes = Math.floor(ageSeconds / 60);
    return { statusLabel: 'Offline', statusClass: 'offline', lastSeenText: `${minutes}m ago` };
  }

  private distanceFromMe(p: ParticipantVm): string {
    if (!this.latestOwnLocation || p.latitude == null || p.longitude == null || p.deviceId === this.deviceId) return '';
    return this.formatDistance(this.haversineMeters(
      this.latestOwnLocation.latitude, this.latestOwnLocation.longitude, p.latitude, p.longitude
    ));
  }

  private refreshOwnWalkingRouteToHostIfNeeded(): void {
    if (this.isHost || this.hostRouteInFlight || !this.latestOwnLocation || this.navigationActive) return;
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
        this.hostWalkingRouteLine = L.polyline(route.points.map(x => L.latLng(x.latitude, x.longitude)), { color: '#2563eb', weight: 7, opacity: 0.92, lineCap: 'round', lineJoin: 'round' }).addTo(this.map);
        if (!this.hasAutoFittedHostRoute) {
          this.hasAutoFittedHostRoute = true;
          this.map.fitBounds(this.hostWalkingRouteLine.getBounds(), { padding: [52, 52], maxZoom: 17, animate: true });
        }
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

  private refreshNavigationRouteIfNeeded(force = false): void {
    if (!this.navigationActive || !this.latestOwnLocation || this.navigationRouteInFlight) return;
    const target = this.getTargetCoordinates(this.navigationTarget);
    if (!target) return;

    const now = Date.now();
    const originMoved = this.lastNavigationOrigin
      ? this.haversineMeters(this.lastNavigationOrigin.latitude, this.lastNavigationOrigin.longitude, this.latestOwnLocation.latitude, this.latestOwnLocation.longitude)
      : Infinity;
    const targetMoved = this.lastNavigationTarget
      ? this.haversineMeters(this.lastNavigationTarget.latitude, this.lastNavigationTarget.longitude, target.latitude, target.longitude)
      : Infinity;
    if (!force && this.lastNavigationRouteAt && (now - this.lastNavigationRouteAt < 8000 || (originMoved < 12 && targetMoved < 12))) return;

    this.navigationRouteInFlight = true;
    this.lastNavigationRouteAt = now;
    this.lastNavigationOrigin = { ...this.latestOwnLocation };
    this.lastNavigationTarget = { ...target };

    this.routes.walking(this.latestOwnLocation.latitude, this.latestOwnLocation.longitude, target.latitude, target.longitude).subscribe({
      next: route => {
        this.navigationRouteInFlight = false;
        if (!this.map || !route.points?.length) return;
        this.hostWalkingRouteLine?.remove();
        this.navigationRouteLine?.remove();
        this.navigationRouteLine = L.polyline(route.points.map(x => L.latLng(x.latitude, x.longitude)), { color: '#2563eb', weight: 8, opacity: 0.96, lineCap: 'round', lineJoin: 'round' }).addTo(this.map);
        this.navigationDistanceText = this.formatDistance(route.distanceMeters);
        this.navigationDurationText = this.formatDuration(route.durationSeconds);
        const nextStep = route.steps?.find(step => step.instruction?.trim());
        this.navigationInstruction = nextStep?.instruction || 'Follow the highlighted walking route';
        this.navigationStepDistanceText = nextStep ? this.formatDistance(nextStep.distanceMeters) : '';
        this.status = `Navigating to ${this.navigationTargetName}.`;
      },
      error: () => {
        this.navigationRouteInFlight = false;
        this.navigationInstruction = 'Route temporarily unavailable. Keep moving toward the target marker.';
      }
    });
  }

  private getTargetCoordinates(target: NavigationTarget): { latitude: number; longitude: number } | null {
    if (target === 'meeting') {
      return this.hasMeetingPoint ? { latitude: this.meetingLatitude!, longitude: this.meetingLongitude! } : null;
    }
    const host = this.participantState.get(this.hostDeviceId);
    return host?.latitude != null && host.longitude != null ? { latitude: host.latitude, longitude: host.longitude } : null;
  }

  private showOwnLocation(latitude: number, longitude: number): void {
    this.initMap(latitude, longitude);
    if (!this.currentMarker) {
      this.currentMarker = L.circleMarker([latitude, longitude], { radius: 11, weight: 4, color: '#ffffff', fillColor: '#2563eb', fillOpacity: 1 }).addTo(this.map!)
        .bindTooltip(this.isHost ? '⭐ You (Host)' : 'You', { permanent: true, direction: 'top', offset: [0, -8] });
    } else {
      this.currentMarker.setLatLng([latitude, longitude]);
      this.currentMarker.bindTooltip(this.isHost ? '⭐ You (Host)' : 'You', { permanent: true, direction: 'top', offset: [0, -8] });
    }
  }

  private resetGroupState(): void {
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
    this.meetingPointMarker?.remove();
    this.meetingPointMarker = undefined;
    this.meetingLatitude = undefined;
    this.meetingLongitude = undefined;
    this.hostWalkingDistanceText = '';
    this.hostWalkingDurationText = '';
    this.hostRouteMode = '';
    this.hostRouteInFlight = false;
    this.lastHostRouteAt = 0;
    this.lastHostOrigin = undefined;
    this.lastHostTarget = undefined;
    this.lastAutoFitParticipantCount = 0;
    this.hasAutoFittedHostRoute = false;
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
    } catch { return null; }
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

  private initMap(lat: number, lng: number, zoom = 17): void {
    if (!this.map) {
      this.map = L.map('map', {
        zoomControl: false,
        preferCanvas: true
      }).setView([lat, lng], zoom);
      // MapLibre GL vector street map (OpenFreeMap) + satellite overlay. No Google Maps API key required.
      this.streetLayer = L.tileLayer('openfreemap://bright', {
        attribution: 'OpenFreeMap · OpenStreetMap contributors',
        maxZoom: 20
      });

      this.satelliteLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          maxZoom: 19
        }
      );

      // Overlay place/road labels on top of satellite imagery for a more familiar navigation view.
      this.satelliteLabelsLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          maxZoom: 19
        }
      );

      this.streetLayer.addTo(this.map);
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);
      this.renderMeetingPoint();
    }
  }

  private showSavedVehicle(lat: number, lng: number): void {
    this.initMap(lat, lng); this.clearVehicleMapObjects();
    this.vehicleMarker = L.circleMarker([lat, lng], { radius: 10, weight: 4, color: '#ffffff', fillColor: '#ef4444', fillOpacity: 1 }).addTo(this.map!)
      .bindTooltip('🚗 Vehicle', { permanent: true, direction: 'top', offset: [0, -8] });
    this.map!.setView([lat, lng], 18);
  }

  private showEndpoints(curLat: number, curLng: number, vehLat: number, vehLng: number): void {
    this.initMap(curLat, curLng);
    this.clearVehicleMapObjects();

    // Always reuse the application's single current-location marker.
    this.showOwnLocation(curLat, curLng);

    this.vehicleMarker = L.circleMarker([vehLat, vehLng], {
      radius: 10, weight: 4, color: '#ffffff', fillColor: '#ef4444', fillOpacity: 1
    }).addTo(this.map!)
      .bindTooltip('🚗 Vehicle', { permanent: true, direction: 'top', offset: [0, -8] });

    this.map!.fitBounds(
      L.latLngBounds([[curLat, curLng], [vehLat, vehLng]]),
      { padding: [70, 70], maxZoom: 18 }
    );
  }

  private showWalkingRoute(route: WalkingRoute, initialFit = true): void {
    if (!this.map || !route.points?.length) {
      this.status = 'A walking route could not be calculated.';
      return;
    }

    this.routeLine?.remove();
    this.vehicleRouteCasingLine?.remove();
    this.fallbackLine?.remove();

    const latLngs = route.points.map(p => L.latLng(p.latitude, p.longitude));

    // White casing + blue route makes the path visible on both street and satellite maps.
    this.vehicleRouteCasingLine = L.polyline(latLngs, {
      color: '#ffffff',
      weight: 11,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false
    }).addTo(this.map);

    this.routeLine = L.polyline(latLngs, {
      color: '#2563eb',
      weight: 7,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false
    }).addTo(this.map);

    this.vehicleRouteCasingLine.bringToFront();
    this.routeLine.bringToFront();
    this.vehicleMarker?.bringToFront();
    this.currentMarker?.bringToFront();

    if (initialFit) {
      this.map.fitBounds(this.routeLine.getBounds(), { padding: [70, 70], maxZoom: 18 });
    }

    this.distanceText = this.formatDistance(route.distanceMeters);
    this.durationText = this.formatDuration(route.durationSeconds);
    this.routeMode = 'Live walking route';
    this.status = 'Live walking route to your vehicle is active.';
  }

  private showFallbackLine(curLat: number, curLng: number, vehLat: number, vehLng: number): void {
    if (!this.map) return;
    this.routeLine?.remove();
    this.vehicleRouteCasingLine?.remove();
    this.fallbackLine?.remove();
    this.fallbackLine = L.polyline([[curLat, curLng], [vehLat, vehLng]], {
      color: '#64748b', weight: 4, dashArray: '8, 10', opacity: 0.8
    }).addTo(this.map);
  }

  private clearVehicleMapObjects(): void {
    // Deliberately do NOT remove currentMarker here. It is shared by group tracking
    // and vehicle navigation, and reusing it prevents duplicate blue dots.
    this.vehicleMarker?.remove();
    this.routeLine?.remove();
    this.vehicleRouteCasingLine?.remove();
    this.fallbackLine?.remove();
    this.vehicleMarker = undefined;
    this.routeLine = undefined;
    this.vehicleRouteCasingLine = undefined;
    this.fallbackLine = undefined;
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
  private bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (v: number) => v * Math.PI / 180;
    const toDeg = (v: number) => v * 180 / Math.PI;
    const φ1 = toRad(lat1); const φ2 = toRad(lat2); const λ = toRad(lng2 - lng1);
    const y = Math.sin(λ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
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
