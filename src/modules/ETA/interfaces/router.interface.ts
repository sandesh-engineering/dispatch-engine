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
