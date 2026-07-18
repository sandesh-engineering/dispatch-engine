- Routes
- Weight calculation
- Dynamic weight calculations ( weight = distance _ traffic _ signals _ construction _ weather _ historical congestion _ turn penalties)
- Shortest path
- Fastest path
- A\* search
- Why Google Maps isn't just A\*
- Contraction Hierarchies (CH)
- Hierarchical Routing
- Bidirectional Search
- Alternative Routes
- Traffic Integration
- ETA Calculation (Modern systems often use machine learning to correct systematic errors. If the graph predicts 12 minutes but similar trips consistently take 14 minutes at 8 AM on Mondays, an ML model can adjust the prediction.)
- Route Geometry (Polyline)

---

## Architecture Overview

### Event-Driven Communication

The ETA module uses a **common interface** (`IEventBus`) that abstracts both internal and external EDA communication:

- **`RabbitMQBus`** — Production event bus backed by RabbitMQ. Uses the platform's `@platform/queue-rabbitmq` (`ConnectionManager` + `RabbitMQService`) for connection lifecycle, exchange/queue assertion, and message consumption with ack/nack semantics.
- **`InternalEventBus`** — In-process event bus using Node.js `EventEmitter`. Used for testing, local development, and CI where RabbitMQ is unavailable.

### Dispatch Command Queue

The `DispatchCommandQueue` listens for three commands from the orchestrator:

| Routing Key                            | Command                | Handler                                                                                                 |
| -------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `dispatch.v1.request-creation`         | Create a new dispatch  | Computes agent→restaurant→customer routes via OSRM, publishes `dispatch.v1.created` with ETA + polyline |
| `dispatch.v1.request-agent-selection`  | Notify nearby agents   | Publishes `agent.v1.notified` (agent selection logic TBD)                                               |
| `dispatch.v1.confirm-agent-assignment` | Confirm assigned agent | Publishes `agent.v1.assigned`                                                                           |

On startup, `provision()`:

1. Connects the event bus
2. Asserts the `dispatch.exchange` (topic, durable)
3. Asserts `dispatch-engine.commands.queue` with DLQ wiring (`dispatch.exchange.dlq`, 24h TTL)
4. Binds all three command routing keys
5. Sets prefetch (10) and starts consuming

### Route Resolution & Provider Abstraction

The `IRouteResolutionRouter` interface decouples route computation from the command queue:

```typescript
export interface IRouteResolutionRouter {
  getRoutes: (params: {
    restaurantCoords: { longitude: number; latitude: number };
    customerCoords: { longitude: number; latitude: number };
    deliveryAgentCoords: { longitude: number; latitude: number };
  }) => Promise<any>;
}
```

**`OsrmRouter`** implements this interface using the Open Source Routing Machine (OSRM) API. To switch providers (e.g. Google Maps Routes API, GraphHopper, Mapbox):

1. Create a new class implementing `IRouteResolutionRouter`
2. Inject it into `DispatchCommandQueue` via the constructor

### Circuit Breaker (opossum)

External API calls to OSRM are protected by a circuit breaker using the **opossum** package:

| Setting                    | Value     | Rationale                                     |
| -------------------------- | --------- | --------------------------------------------- |
| `timeout`                  | 5,000 ms  | Each OSRM call must complete within 5 seconds |
| `errorThresholdPercentage` | 50        | Open circuit when ≥50% of requests fail       |
| `resetTimeout`             | 30,000 ms | Wait 30s before probing after open            |
| `rollingCountTimeout`      | 10,000 ms | Statistics window for failure counting        |
| `rollingCountBuckets`      | 10        | Number of buckets in the rolling window       |

**Why opossum?**

- Minimal, battle-tested circuit breaker for Node.js (used at Netflix scale)
- Provides **bulkheading**: a failing OSRM provider won't cascade into the dispatch engine
- Publishes state-change events (`open`, `close`, `halfOpen`) for observability
- Pairs naturally with a **fallback** response (zeroed-out route data) when the circuit is open, allowing the saga to advance with degraded data rather than failing entirely

### Lifecycle Management

The module exposes `bootstrap()` and `EtaModuleHandle.destroy()` from its barrel (`index.ts`):

```typescript
// server.ts
import { bootstrap } from './modules/ETA';

const etaModule = await bootstrap(rabbitMqConfig);
// ... on shutdown:
await etaModule.destroy();
```

This keeps the server file clean and provides better isolation — the server only knows about `bootstrap`/`destroy`, not the internal wiring.

### File Structure

```
ETA/
├── README.md
├── index.ts                    # Barrel — exports all public APIs
├── bootstrap.ts                # bootstrap() / EtaModuleHandle
├── interfaces/
│   ├── event-bus.interface.ts  # IEventBus (shared in src/interfaces/)
│   └── router.interface.ts     # IRouteResolutionRouter
├── types/
│   └── events.ts               # Event payloads, routing key constants
├── events/
│   ├── rabbitmq.bus.ts         # RabbitMQBus — production event bus
│   └── command-queue.ts        # DispatchCommandQueue — command consumer
└── router/
    └── osrm.router.ts          # OsrmRouter — OSRM API with circuit breaker
```
