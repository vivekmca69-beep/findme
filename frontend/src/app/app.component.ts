import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParkingService, SavedParkingLocation } from './services/parking.service';
import { RoutePreferenceMode, RouteService, WalkingRoute } from './services/route.service';
import {
  FriendGroupRoute,
  FriendLocationUpdate,
  FriendParticipantState,
  FriendService,
  FriendSessionState
} from './services/friend.service';
import { L } from './map/google-maps-compat';

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
  // Temporary straight connectors are shown only while a road route is being calculated.
  private participantLines = new Map<string, L.Polyline>();
  private participantState = new Map<string, ParticipantVm>();
  private groupRouteState = new Map<string, FriendGroupRoute>();
  private groupRouteLines = new Map<string, L.Polyline>();
  private groupRouteCasings = new Map<string, L.Polyline>();
  private groupRouteInFlight = new Set<string>();
  private navigationRouteInFlight = false;
  private lastNavigationRouteAt = 0;
  private lastNavigationOrigin?: { latitude: number; longitude: number };
  private lastNavigationTarget?: { latitude: number; longitude: number };
  private participantStatusTimer?: number;
  private readonly activeSessionStorageKey = 'findme-active-session';
  private readonly savedVehicleStorageKey = 'findme-saved-vehicle';
  private readonly orientationHandler = (event: DeviceOrientationEvent) => this.handleOrientation(event);

  status = 'Map ready';
  deviceId = this.getDeviceId();
  distanceText = '';
  durationText = '';
  routeMode = '';
  routePreferenceMode: RoutePreferenceMode = 'car';
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

  // UI action guards: asynchronous actions add a key here while they are running.
  // Buttons bind to these keys so repeated taps cannot send duplicate requests.
  private busyActions = new Set<string>();
  private pendingNavigationBusyAction?: string;

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

  get isVehicleActionBusy(): boolean {
    return this.isBusy('saveVehicle') || this.isBusy('findVehicle') || this.isBusy('clearVehicle');
  }

  get isSessionActionBusy(): boolean {
    return this.isBusy('createSession') || this.isBusy('joinSession') || this.isBusy('stopSharing');
  }

  get isRouteProcessing(): boolean {
    return this.vehicleRouteInFlight || this.navigationRouteInFlight || this.groupRouteInFlight.size > 0;
  }

  get isAnyActionBusy(): boolean {
    return this.busyActions.size > 0 || this.isRouteProcessing;
  }

  isBusy(action: string): boolean {
    return this.busyActions.has(action);
  }

  private beginBusy(action: string): boolean {
    if (this.busyActions.has(action)) return false;
    this.busyActions.add(action);
    return true;
  }

  private endBusy(action: string): void {
    this.busyActions.delete(action);
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
    if (!this.beginBusy('saveVehicle')) return;
    this.status = 'Getting your current location...';
    this.clearRouteInfo();
    this.getCurrentPosition().then(pos => {
      const payload = { deviceId: this.deviceId, latitude: pos.coords.latitude, longitude: pos.coords.longitude };

      // Keep a browser-local copy immediately. Redis is the server-side source of truth,
      // but this backup means a parked vehicle is still recoverable on the same browser
      // even if the backend is temporarily asleep/unavailable.
      this.saveVehicleLocally({ ...payload, savedAtUtc: new Date().toISOString() });

      this.parking.save(payload).subscribe({
        next: saved => {
          this.saveVehicleLocally(saved);
          this.status = 'Vehicle location saved until you replace or clear it.';
          this.showSavedVehicle(payload.latitude, payload.longitude);
          this.endBusy('saveVehicle');
        },
        error: () => {
          this.status = 'Vehicle saved on this phone. Server sync is temporarily unavailable.';
          this.showSavedVehicle(payload.latitude, payload.longitude);
          this.endBusy('saveVehicle');
        }
      });
    }).catch(err => {
      this.status = String(err);
      this.endBusy('saveVehicle');
    });
  }

  findVehicle(): void {
    if (!this.beginBusy('findVehicle')) return;
    this.status = 'Finding your vehicle...';
    this.clearRouteInfo();

    // Prevent duplicate GPS watchers/markers when Find vehicle is tapped repeatedly.
    this.stopVehicleNavigation(false);

    this.parking.get(this.deviceId).subscribe({
      next: vehicle => {
        this.saveVehicleLocally(vehicle);
        this.beginVehicleNavigation(vehicle);
      },
      error: () => {
        const localVehicle = this.readVehicleLocally();
        if (localVehicle) {
          this.status = 'Using the parking location saved on this phone.';
          this.beginVehicleNavigation(localVehicle);
        } else {
          this.status = 'No saved vehicle location found. Save your vehicle first.';
          this.endBusy('findVehicle');
        }
      }
    });
  }

  clearSavedVehicle(): void {
    if (!this.beginBusy('clearVehicle')) return;
    this.stopVehicleNavigation(false);
    localStorage.removeItem(this.savedVehicleStorageKey);
    this.clearVehicleMapObjects();
    this.parking.clear(this.deviceId).subscribe({
      next: () => {
        this.status = 'Saved vehicle location cleared.';
        this.endBusy('clearVehicle');
      },
      error: () => {
        this.status = 'Vehicle cleared on this phone; server cleanup will retry when you save again.';
        this.endBusy('clearVehicle');
      }
    });
  }

  private beginVehicleNavigation(vehicle: SavedParkingLocation): void {
    this.vehicleTarget = { latitude: vehicle.latitude, longitude: vehicle.longitude };
    this.vehicleNavigationActive = true;
    this.routeMode = 'Calculating road route…';
    this.status = `Starting live ${this.routeModeLabel(this.routePreferenceMode).toLowerCase()} navigation to your vehicle...`;

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
      this.endBusy('findVehicle');
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
    if (updateStatus) {
      this.endBusy('findVehicle');
      this.status = 'Vehicle navigation stopped.';
    }
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

    this.routes.preferred(
      latitude,
      longitude,
      this.vehicleTarget.latitude,
      this.vehicleTarget.longitude,
      this.routePreferenceMode
    ).subscribe({
      next: route => {
        this.vehicleRouteInFlight = false;
        if (force) this.endBusy('findVehicle');
        if (!route.points || route.points.length < 2) {
          this.showFallbackLine(latitude, longitude, this.vehicleTarget!.latitude, this.vehicleTarget!.longitude);
          this.routeMode = 'Direct-line fallback';
          return;
        }
        this.showWalkingRoute(route, force);
      },
      error: () => {
        this.vehicleRouteInFlight = false;
        if (force) this.endBusy('findVehicle');
        this.showFallbackLine(latitude, longitude, this.vehicleTarget!.latitude, this.vehicleTarget!.longitude);
        this.status = 'Road route is temporarily unavailable. Direct line shown.';
        this.routeMode = 'Direct-line fallback';
      }
    });
  }

  createFriendSession(): void {
    if (!this.beginBusy('createSession')) return;
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
        } finally {
          this.endBusy('createSession');
        }
      },
      error: () => {
        this.status = 'Could not create group session.';
        this.endBusy('createSession');
      }
    });
  }

  joinFriendSession(): void {
    const code = this.joinCode.trim();
    if (!/^\d{6}$/.test(code)) {
      this.status = 'Enter a valid 6-digit session code.';
      return;
    }
    if (!this.beginBusy('joinSession')) return;
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
        } finally {
          this.endBusy('joinSession');
        }
      },
      error: err => {
        this.status = err?.error?.message ?? 'Could not join this session.';
        this.endBusy('joinSession');
      }
    });
  }

  async stopSharing(): Promise<void> {
    if (!this.beginBusy('stopSharing')) return;
    this.stopLocationWatch();
    this.stopNavigation();
    this.stopCompass();
    const code = this.activeSessionCode;
    const wasHost = this.isHost;
    this.clearActiveSession();
    try {
      if (code) {
        try { await this.friends.leave(code, this.deviceId); }
        catch { await this.friends.disconnect(); }
      }
      this.resetGroupState();
      this.status = wasHost ? 'Session closed.' : 'Location sharing stopped.';
    } finally {
      this.endBusy('stopSharing');
    }
  }

  async createSmartMeetingPoint(): Promise<void> {
    if (!this.isHost || !this.activeSessionCode) return;
    const live = [...this.participantState.values()].filter(p => p.latitude != null && p.longitude != null);
    if (live.length < 2) {
      this.status = 'At least two live GPS positions are required for a meeting point.';
      return;
    }
    if (!this.beginBusy('meetingPoint')) return;

    const latitude = live.reduce((sum, p) => sum + (p.latitude ?? 0), 0) / live.length;
    const longitude = live.reduce((sum, p) => sum + (p.longitude ?? 0), 0) / live.length;
    try {
      await this.friends.setMeetingPoint(this.activeSessionCode, this.deviceId, latitude, longitude);
      this.status = 'Balanced meeting point shared with the group.';
    } catch (error) {
      this.status = this.errorMessage(error, 'Could not set the meeting point.');
    } finally {
      this.endBusy('meetingPoint');
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
    const action = target === 'meeting' ? 'navigateMeeting' : 'navigateHost';
    if (!this.beginBusy(action)) return;
    this.pendingNavigationBusyAction = action;
    this.navigationTarget = target;
    this.navigationTargetName = target === 'meeting' ? 'Meeting point' : (this.hostParticipant?.displayName || 'Host');
    this.navigationActive = true;
    this.navigationInstruction = 'Calculating route…';
    this.lastNavigationRouteAt = 0;
    this.lastNavigationOrigin = undefined;
    this.lastNavigationTarget = undefined;
    this.refreshNavigationRouteIfNeeded(true);
    this.status = `Calculating route to ${this.navigationTargetName}...`;
  }

  stopNavigation(): void {
    if (this.pendingNavigationBusyAction) {
      this.endBusy(this.pendingNavigationBusyAction);
      this.pendingNavigationBusyAction = undefined;
    }
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

    const action = target === 'meeting' ? 'compassMeeting' : 'compassHost';
    if (!this.beginBusy(action)) return;
    try {
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
    } finally {
      this.endBusy(action);
    }
  }

  recenterOnMe(): void {
    if (this.latestOwnLocation) this.map?.setView([this.latestOwnLocation.latitude, this.latestOwnLocation.longitude], 18);
  }

  setRoutePreferenceMode(mode: RoutePreferenceMode): void {
    if (this.routePreferenceMode === mode) return;
    this.routePreferenceMode = mode;

    // Immediately re-route active personal navigation using the selected profile.
    this.lastVehicleRouteAt = 0;
    this.lastNavigationRouteAt = 0;
    if (this.vehicleNavigationActive && this.latestOwnLocation) {
      this.refreshVehicleRoute(this.latestOwnLocation.latitude, this.latestOwnLocation.longitude, true);
    }
    if (this.navigationActive) this.refreshNavigationRouteIfNeeded(true);

    // The host owns shared group road routes. Clear its local cache so it
    // republishes the group network using the newly selected route profile.
    if (this.isHost) {
      for (const line of this.groupRouteLines.values()) line.remove();
      for (const line of this.groupRouteCasings.values()) line.remove();
      this.groupRouteLines.clear();
      this.groupRouteCasings.clear();
      this.groupRouteState.clear();
      this.refreshGroupRoadRoutesIfNeeded();
    }

    this.status = `${this.routeModeLabel(mode)} routing selected.`;
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
      },
      route => this.handleGroupRoute(route)
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

    const incomingRouteTargets = new Set((state.groupRoutes ?? []).map(route => route.targetDeviceId));
    for (const targetId of [...this.groupRouteState.keys()]) {
      if (!incomingRouteTargets.has(targetId) || !incomingIds.has(targetId)) {
        this.groupRouteState.delete(targetId);
        this.groupRouteLines.get(targetId)?.remove();
        this.groupRouteCasings.get(targetId)?.remove();
        this.groupRouteLines.delete(targetId);
        this.groupRouteCasings.delete(targetId);
      }
    }
    for (const route of state.groupRoutes ?? []) {
      this.groupRouteState.set(route.targetDeviceId, route);
      this.renderGroupRoute(route);
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

    // Every participant gets a visible connection to the host on every device.
    // A dashed direct connector is only temporary while the shared road route is
    // being calculated by the host. Once the road route arrives, the dashed line
    // is removed for everyone.
    const validIds = new Set<string>();
    for (const p of this.participantState.values()) {
      if (p.deviceId === this.hostDeviceId || p.latitude == null || p.longitude == null) continue;
      validIds.add(p.deviceId);
      const roadRoute = this.groupRouteState.get(p.deviceId);
      if (roadRoute?.points?.length) {
        this.participantLines.get(p.deviceId)?.remove();
        this.participantLines.delete(p.deviceId);
        this.renderGroupRoute(roadRoute);
        continue;
      }

      let line = this.participantLines.get(p.deviceId);
      const points: L.LatLngExpression[] = [[host.latitude, host.longitude], [p.latitude, p.longitude]];
      if (!line) {
        line = L.polyline(points, { color: '#94a3b8', weight: 3, dashArray: '7, 9', opacity: 0.72 }).addTo(this.map);
        this.participantLines.set(p.deviceId, line);
      } else {
        line.setLatLngs(points);
      }
    }

    for (const [id, line] of [...this.participantLines.entries()]) {
      if (!validIds.has(id)) { line.remove(); this.participantLines.delete(id); }
    }

    // Only the host requests road routes. It then broadcasts them through
    // SignalR, so all users see exactly the same road-connected group network
    // without every phone consuming the routing API quota.
    this.refreshGroupRoadRoutesIfNeeded();
  }

  private handleGroupRoute(route: FriendGroupRoute): void {
    if (!route?.targetDeviceId || !route.points?.length) return;
    this.groupRouteState.set(route.targetDeviceId, route);
    this.renderGroupRoute(route);
    this.participantLines.get(route.targetDeviceId)?.remove();
    this.participantLines.delete(route.targetDeviceId);
    this.refreshOwnWalkingRouteToHostIfNeeded();
  }

  private renderGroupRoute(route: FriendGroupRoute): void {
    if (!this.map || !route.points?.length) return;
    const points = route.points.map(point => L.latLng(point.latitude, point.longitude));

    let casing = this.groupRouteCasings.get(route.targetDeviceId);
    if (!casing) {
      casing = L.polyline(points, {
        color: '#1d4ed8', weight: 10, opacity: 0.45, lineCap: 'round', lineJoin: 'round', interactive: false
      }).addTo(this.map);
      this.groupRouteCasings.set(route.targetDeviceId, casing);
    } else {
      casing.setLatLngs(points);
    }

    let line = this.groupRouteLines.get(route.targetDeviceId);
    if (!line) {
      line = L.polyline(points, {
        color: '#4285f4', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false
      }).addTo(this.map);
      this.groupRouteLines.set(route.targetDeviceId, line);
    } else {
      line.setLatLngs(points);
    }

    casing.bringToFront();
    line.bringToFront();
    for (const marker of this.participantMarkers.values()) marker.bringToFront();
    this.currentMarker?.bringToFront();
  }

  private refreshGroupRoadRoutesIfNeeded(): void {
    if (!this.isHost || !this.activeSessionCode) return;
    const host = this.participantState.get(this.hostDeviceId);
    if (!host || host.latitude == null || host.longitude == null) return;

    const now = Date.now();
    for (const participant of this.participantState.values()) {
      if (participant.deviceId === this.hostDeviceId || participant.latitude == null || participant.longitude == null) continue;
      if (this.groupRouteInFlight.has(participant.deviceId)) continue;

      const existing = this.groupRouteState.get(participant.deviceId);
      if (existing) {
        const age = now - Date.parse(existing.updatedAtUtc);
        const hostMoved = this.haversineMeters(
          existing.fromLatitude, existing.fromLongitude, host.latitude, host.longitude
        );
        const participantMoved = this.haversineMeters(
          existing.toLatitude, existing.toLongitude, participant.latitude, participant.longitude
        );

        // Keep markers live through SignalR, but only spend a routing request when
        // movement is meaningful and at least 25 seconds have elapsed.
        // With the app capped at 10 people, this keeps route updates responsive
        // while staying comfortably below the routing service minute limit.
        if (age < 25000 || (hostMoved < 25 && participantMoved < 25)) continue;
      }

      this.groupRouteInFlight.add(participant.deviceId);
      const fromLatitude = host.latitude;
      const fromLongitude = host.longitude;
      const toLatitude = participant.latitude;
      const toLongitude = participant.longitude;

      this.routes.preferred(fromLatitude, fromLongitude, toLatitude, toLongitude, this.routePreferenceMode).subscribe({
        next: route => {
          this.groupRouteInFlight.delete(participant.deviceId);
          if (!route.points?.length) return;
          const shared: FriendGroupRoute = {
            hostDeviceId: this.hostDeviceId,
            targetDeviceId: participant.deviceId,
            fromLatitude,
            fromLongitude,
            toLatitude,
            toLongitude,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            updatedAtUtc: new Date().toISOString(),
            points: route.points
          };
          this.handleGroupRoute(shared);
          void this.friends.publishGroupRoute(
            this.activeSessionCode,
            this.deviceId,
            participant.deviceId,
            {
              fromLatitude, fromLongitude, toLatitude, toLongitude,
              distanceMeters: route.distanceMeters,
              durationSeconds: route.durationSeconds,
              points: route.points
            }
          ).catch(() => {
            this.status = 'Group route is visible locally but could not be shared yet.';
          });
        },
        error: () => {
          this.groupRouteInFlight.delete(participant.deviceId);
          // Keep the temporary dashed connector if road routing is unavailable.
        }
      });
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
    if (this.isHost || !this.hostDeviceId) {
      this.hostWalkingDistanceText = '';
      this.hostWalkingDurationText = '';
      this.hostRouteMode = '';
      return;
    }

    // Guests reuse the host-published road route instead of each phone calling
    // OpenRouteService separately. This keeps every map consistent and saves quota.
    const route = this.groupRouteState.get(this.deviceId);
    if (!route?.points?.length) {
      this.hostWalkingDistanceText = '';
      this.hostWalkingDurationText = '';
      this.hostRouteMode = 'Waiting for road route from host';
      return;
    }

    this.hostWalkingRouteLine?.remove();
    this.hostWalkingRouteLine = undefined;
    this.hostWalkingDistanceText = this.formatDistance(route.distanceMeters);
    this.hostWalkingDurationText = this.formatDuration(route.durationSeconds);
    this.hostRouteMode = 'Shared road route to host';
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

    this.routes.preferred(this.latestOwnLocation.latitude, this.latestOwnLocation.longitude, target.latitude, target.longitude, this.routePreferenceMode).subscribe({
      next: route => {
        this.navigationRouteInFlight = false;
        if (this.pendingNavigationBusyAction) {
          this.endBusy(this.pendingNavigationBusyAction);
          this.pendingNavigationBusyAction = undefined;
        }
        if (!this.map || !route.points?.length) return;
        this.hostWalkingRouteLine?.remove();
        this.navigationRouteLine?.remove();
        this.navigationRouteLine = L.polyline(route.points.map(x => L.latLng(x.latitude, x.longitude)), { color: '#4285f4', weight: 8, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(this.map);
        this.navigationDistanceText = this.formatDistance(route.distanceMeters);
        this.navigationDurationText = this.formatDuration(route.durationSeconds);
        const nextStep = route.steps?.find(step => step.instruction?.trim());
        this.navigationInstruction = nextStep?.instruction || 'Follow the highlighted route';
        this.navigationStepDistanceText = nextStep ? this.formatDistance(nextStep.distanceMeters) : '';
        this.status = `Navigating to ${this.navigationTargetName}.`;
      },
      error: () => {
        this.navigationRouteInFlight = false;
        if (this.pendingNavigationBusyAction) {
          this.endBusy(this.pendingNavigationBusyAction);
          this.pendingNavigationBusyAction = undefined;
        }
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
    for (const line of this.groupRouteLines.values()) line.remove();
    for (const casing of this.groupRouteCasings.values()) casing.remove();
    this.groupRouteLines.clear();
    this.groupRouteCasings.clear();
    this.groupRouteState.clear();
    this.groupRouteInFlight.clear();
    this.hostWalkingRouteLine?.remove();
    this.hostWalkingRouteLine = undefined;
    this.meetingPointMarker?.remove();
    this.meetingPointMarker = undefined;
    this.meetingLatitude = undefined;
    this.meetingLongitude = undefined;
    this.hostWalkingDistanceText = '';
    this.hostWalkingDurationText = '';
    this.hostRouteMode = '';
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

  private saveVehicleLocally(location: SavedParkingLocation): void {
    localStorage.setItem(this.savedVehicleStorageKey, JSON.stringify(location));
  }

  private readVehicleLocally(): SavedParkingLocation | null {
    const raw = localStorage.getItem(this.savedVehicleStorageKey);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (typeof value?.latitude !== 'number' || typeof value?.longitude !== 'number') return null;
      return {
        deviceId: typeof value.deviceId === 'string' ? value.deviceId : this.deviceId,
        latitude: value.latitude,
        longitude: value.longitude,
        savedAtUtc: typeof value.savedAtUtc === 'string' ? value.savedAtUtc : undefined
      };
    } catch {
      return null;
    }
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
      this.streetLayer = L.tileLayer('google://roadmap');
      this.satelliteLayer = L.tileLayer('google://hybrid');
      this.satelliteLabelsLayer = L.tileLayer('google://labels');

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
      color: '#1d4ed8',
      weight: 11,
      opacity: 0.42,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false
    }).addTo(this.map);

    this.routeLine = L.polyline(latLngs, {
      color: '#4285f4',
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
    this.routeMode = this.routeModeLabel(this.routePreferenceMode);
    this.status = `${this.routeModeLabel(this.routePreferenceMode)} route to your vehicle is active.`;
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

  private routeModeLabel(mode: RoutePreferenceMode): string {
    switch (mode) {
      case 'car': return 'Car';
      case 'two_wheeler': return 'Two-wheeler';
      case 'bicycle': return 'Bicycle';
      default: return 'Walking';
    }
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
