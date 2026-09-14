import { Coordinates } from 'src/modules/candidate-discovery';
import { RankableAgent } from 'src/modules/ranking';

export interface IRouteResolutionRouter {
  getRoutes: ({
    customerCoords,
    deliveryAgentCoords,
    restaurantCoords,
  }: {
    restaurantCoords: { longitude: number; latitude: number };
    customerCoords: { longitude: number; latitude: number };
    deliveryAgentCoords: {
      longitude: number;
      latitude: number;
    };
  }) => Promise<any>;
}

export interface TravelEstimate {
  distanceMeters: number;
  durationSeconds: number;
  geometry?: string;
}

export interface AgentRouteEstimate {
  agentId: string;
  agentToRestaurant: TravelEstimate;
}

export interface RouteMatrix {
  restaurantToCustomer: TravelEstimate;
  agents: AgentRouteEstimate[];
}

export interface IRouteMatrixResolver {
  resolve(
    agents: RankableAgent[],
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
  ): Promise<RouteMatrix>;
}

export interface IOsrmClient {
  table(params: {
    coordinates: Coordinates[];
    sources: number[];
    destinations: number[];
  }): Promise<unknown>;
}
