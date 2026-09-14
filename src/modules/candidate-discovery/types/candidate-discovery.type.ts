import { AgentAvailabilityStatus } from 'src/modules/eta';

export interface Coordinates {
  longitude: number;
  latitude: number;
}

export interface NearbyAgent {
  member: string;
  distance: number;
  coordinates: Coordinates;
}

/* This will be same as we have in the realtime gateway so can be shared */
export interface AgentSession {
  availability: AgentAvailabilityStatus;
  connected: boolean;
}

export interface EligibleAgent extends NearbyAgent {
  session: AgentSession;
}
