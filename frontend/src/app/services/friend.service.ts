import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as signalR from '@microsoft/signalr';
import { environment } from '../../environments/environment.generated';

export interface FriendLocationUpdate {
  deviceId: string;
  displayName: string;
  isHost: boolean;
  latitude: number;
  longitude: number;
  locationUpdatedAtUtc?: string;
}

export interface FriendParticipantState {
  deviceId: string;
  displayName: string;
  isHost: boolean;
  latitude?: number | null;
  longitude?: number | null;
  locationUpdatedAtUtc?: string | null;
}

export interface FriendSessionState {
  sessionCode: string;
  hostDeviceId: string;
  participantCount: number;
  maxParticipants: number;
  meetingLatitude?: number | null;
  meetingLongitude?: number | null;
  meetingUpdatedAtUtc?: string | null;
  participants: FriendParticipantState[];
}

export interface FriendSessionIdentity {
  sessionCode: string;
  hostDeviceId: string;
  maxParticipants: number;
  displayName?: string;
}

@Injectable({ providedIn: 'root' })
export class FriendService {
  private readonly api = `${environment.apiBaseUrl}/api/friend`;
  private readonly hubUrl = `${environment.apiBaseUrl}/hubs/friend`;
  private connection?: signalR.HubConnection;
  private connectedSessionCode = '';
  private connectedDeviceId = '';

  constructor(private http: HttpClient) {}

  create(deviceId: string, displayName: string) {
    return this.http.post<FriendSessionIdentity>(`${this.api}/create`, { deviceId, displayName });
  }

  join(sessionCode: string, deviceId: string, displayName: string) {
    return this.http.post<FriendSessionIdentity>(`${this.api}/join`, { sessionCode, deviceId, displayName });
  }

  restore(sessionCode: string, deviceId: string) {
    return this.http.post<FriendSessionIdentity>(`${this.api}/restore`, { sessionCode, deviceId });
  }

  async connect(
    sessionCode: string,
    deviceId: string,
    onLocation: (update: FriendLocationUpdate) => void,
    onSessionState: (state: FriendSessionState) => void,
    onSessionClosed: () => void
  ): Promise<void> {
    await this.disconnect();

    this.connectedSessionCode = sessionCode;
    this.connectedDeviceId = deviceId;

    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(this.hubUrl)
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .build();

    this.connection.on('LocationUpdated', (update: FriendLocationUpdate) => onLocation(update));
    this.connection.on('SessionState', (state: FriendSessionState) => onSessionState(state));
    this.connection.on('ParticipantChanged', (state: FriendSessionState) => onSessionState(state));
    this.connection.on('SessionClosed', () => onSessionClosed());

    this.connection.onreconnected(async () => {
      if (!this.connection || !this.connectedSessionCode || !this.connectedDeviceId) return;
      try {
        await this.connection.invoke('ConnectToSession', this.connectedSessionCode, this.connectedDeviceId);
      } catch {}
    });

    await this.connection.start();
    await this.connection.invoke('ConnectToSession', sessionCode, deviceId);
  }

  async sendLocation(sessionCode: string, deviceId: string, latitude: number, longitude: number): Promise<void> {
    if (!this.connection || this.connection.state !== signalR.HubConnectionState.Connected) return;
    await this.connection.invoke('UpdateLocation', sessionCode, deviceId, latitude, longitude);
  }

  async setMeetingPoint(sessionCode: string, deviceId: string, latitude: number, longitude: number): Promise<void> {
    if (!this.connection || this.connection.state !== signalR.HubConnectionState.Connected) {
      throw new Error('Live connection is not ready.');
    }
    await this.connection.invoke('SetMeetingPoint', sessionCode, deviceId, latitude, longitude);
  }

  async leave(sessionCode: string, deviceId: string): Promise<void> {
    if (this.connection?.state === signalR.HubConnectionState.Connected) {
      await this.connection.invoke('LeaveSession', sessionCode, deviceId);
    }
    await this.disconnect();
  }

  async disconnect(): Promise<void> {
    if (!this.connection) {
      this.connectedSessionCode = '';
      this.connectedDeviceId = '';
      return;
    }
    try {
      await this.connection.stop();
    } finally {
      this.connection = undefined;
      this.connectedSessionCode = '';
      this.connectedDeviceId = '';
    }
  }
}
