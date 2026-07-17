import axios from 'axios';

interface IRouteResolutionRouter {
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

export class OsrmRouter implements IRouteResolutionRouter {
  async getRoutes({
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
  }) {
    const agentToRestaurantUrl = `https://router.project-osrm.org/route/v1/driving/${deliveryAgentCoords.longitude},${deliveryAgentCoords.latitude};${restaurantCoords.longitude},${restaurantCoords.latitude}?alternatives=true`;

    const restaurantToCustomerUrl = `https://router.project-osrm.org/route/v1/driving/${restaurantCoords.longitude},${restaurantCoords.latitude};${customerCoords.longitude},${customerCoords.latitude}?alternatives=true`;

    const [agentToRestaurantResponse, restaurantToCustomerResponse] =
      await Promise.all([
        axios.get(agentToRestaurantUrl, {
          params: {
            overview: 'full',
            geometries: 'geojson',
            steps: true,
          },
        }),

        axios.get(restaurantToCustomerUrl, {
          params: {
            overview: 'full',
            geometries: 'geojson',
            steps: true,
          },
        }),
      ]);

    console.log(
      agentToRestaurantResponse.data,
      restaurantToCustomerResponse.data,
    );

    return {
      agentToRestaurantResponse: agentToRestaurantResponse.data,
      restaurantToCustomerResponse: restaurantToCustomerResponse.data,
    };
  }
}
