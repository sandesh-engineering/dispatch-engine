# Dispatch Engine — Architecture

> **Service role:** Stateless command processor that sits between the
> [workflow-orchestrator](../workflow-orchestrator) and the
> [realtime-gateway](../realtime-gateway). It receives dispatch commands over
> RabbitMQ, runs candidate discovery + route resolution + ETA calculation, and
> publishes result events back to the orchestrator.

---

## Table of Contents

1. [System Context](#1-system-context)
2. [Startup & Lifecycle](#2-startup--lifecycle)
3. [Module Map](#3-module-map)
4. [End-to-End Workflow](#4-end-to-end-workflow)
5. [Event Contract](#5-event-contract)
6. [Internal Dependency Graph](#6-internal-dependency-graph)
7. [Key Design Decisions](#7-key-design-decisions)
8. [Configuration Reference](#8-configuration-reference)
9. [Observability](#9-observability)
10. [Cross-Service Backlinks](#10-cross-service-backlinks)

---

## 1. System Context

```
 ┌──────────────────────┐          dispatch.exchange (RabbitMQ/topic)
 │  workflow-orchestrator│ ──── dispatch.v1.request-creation ──────────────┐
 │  (Saga coordinator)  │ ──── dispatch.v1.request-agent-selection ─────── │ ──►  Dispatch Engine
 │                      │ ──── dispatch.v1.confirm-agent-assignment ─────── │
 └──────────────────────┘                                                   │
           ▲                                                                 │
           │  dispatch.v1.created                                            │
           │  dispatch.v1.creation-rejected                                  │
           │  agent.v1.notified                                              │
           └──  agent.v1.assigned  ◄────────────────────────────────────────┘

 ┌──────────────────────┐
 │  realtime-gateway    │  ◄── (reads delivery-agent location from Redis,
 │                      │       writes session & availability state to Redis)
 └──────────────────────┘
       ▲
       │  Redis (location:delivery-agents geo-set, delivery-agent:{id} hash)
       └──────────────────────────────────────────────────────── Dispatch Engine
```

The dispatch engine **does not** call the realtime-gateway directly. Both
services share Redis: the gateway writes agent location and session state;
the engine reads them during candidate discovery.

---

## 2. Startup & Lifecycle

Entry point: [`src/server.ts`](./src/server.ts)

```
1. Express HTTP server binds on $PORT (default 5000)
   └─ GET  /metrics        — Prometheus metrics
   └─ POST /api/v1/nearby-delivery-agents  — debug geo-search endpoint

2. bootstrap() [src/modules/eta/bootstrap.ts]
   ├─ Creates RabbitMQBus → connects → asserts dispatch.exchange (topic)
   ├─ Creates OsrmClient → OsrmTableResolver
   ├─ Creates ProgressiveCandidateDiscovery (Redis cache)
   ├─ Creates AgentRankingService (SortTankingStrategy + DeliveryAgentScoring)
   ├─ Creates EtaAggregatorService (DriverMetricsProvider)
   ├─ Creates EtaService (wires all of the above)
   └─ Creates DispatchCommandQueue → provision()
         ├─ connect()
         ├─ assertQueue('dispatch-engine.commands.queue', durable)
         ├─ bindQueue for each DISPATCH_COMMANDS routing key
         ├─ prefetch(10)
         └─ consume → handleCommand()

3. SIGTERM / SIGINT → shutdown()
   └─ EtaModuleHandle.destroy() → RabbitMQBus.disconnect()
```

---

## 3. Module Map

```
src/
├── server.ts                    — Process entry point; bootstrap + graceful shutdown
├── app.ts                       — Express app (middlewares, REST endpoint, metrics)
├── config/
│   └── envs.ts                  — Zod-validated environment schema
├── utils/
│   └── cache-bootstrap.ts       — Singleton CacheService (Redis)
├── middlewares/
│   └── error.middleware.ts      — Global Express error handler
├── interfaces/
│   └── event-bus.interface.ts   — IEventBus (publish / subscribe / connect / disconnect)
└── modules/
    ├── eta/                     — Primary bootstrap module & command queue
    │   ├── bootstrap.ts         — Wires full dependency graph; exported as bootstrap()
    │   ├── index.ts             — Public barrel exports
    │   ├── events/
    │   │   ├── rabbitmq.bus.ts  — RabbitMQBus: IEventBus implementation (production)
    │   │   └── command-queue.ts — DispatchCommandQueue: consumes commands, calls EtaService
    │   ├── services/
    │   │   ├── eta-base.service.ts      — EtaService: discovery → ranking → matrix → threshold
    │   │   ├── eta-aggregator.service.ts — EtaAggregatorService: driver-adjusted ETA
    │   │   ├── driver.service.ts        — DriverMetricsProvider (stub; replace w/ real data)
    │   │   ├── historical-data.service.ts — Stub
    │   │   ├── restaurant.service.ts    — Stub
    │   │   ├── traffic.service.ts       — Stub
    │   │   └── weather.service.ts       — Stub
    │   ├── interfaces/
    │   │   ├── agent.interface.ts — OrderStatus, AgentAvailabilityStatus, AgentState
    │   │   └── eta.interface.ts   — EtaConfig (maxTotalDistanceMeters, maxTotalEtaSeconds)
    │   ├── types/
    │   │   ├── events.ts          — Command/event payloads + routing-key constants
    │   │   └── eta.types.ts       — Route, CandidatesFromMatrix
    │   └── router/
    │       └── osrm.router.ts     — Legacy OsrmRouter (kept for reference; superseded by route-discovery)
    │
    ├── candidate-discovery/     — Redis geo-search with progressive radius expansion
    │   ├── constants/
    │   │   └── search-level.constant.ts — [{radiusKm: 2, maxCandidates: 30}, ...]
    │   ├── interfaces/
    │   │   └── candidate-discovery.interface.ts — CandidateDiscoveryStrategy
    │   ├── services/
    │   │   └── progressive-candidate-discovery.service.ts — ProgressiveCandidateDiscovery
    │   └── types/
    │       └── candidate-discovery.type.ts — Coordinates, NearbyAgent, AgentSession, EligibleAgent
    │
    ├── ranking/                 — Weighted multi-signal agent scoring & batch selection
    │   ├── interfaces/
    │   │   └── ranking.interface.ts — RankingStrategy, IAgentRankingService
    │   ├── services/
    │   │   ├── agent-ranking.service.ts   — AgentRankingService (orchestrates scoring + strategy)
    │   │   ├── scoring.service.ts         — DeliveryAgentScoring (normalised score per signal)
    │   │   ├── sort-ranking.service.ts    — SortTankingStrategy (descending score sort)
    │   │   └── ranking-result.service.ts  — RankingResult (stateful batch iterator)
    │   └── types/
    │       └── ranking.types.ts — RankableAgent, RankingConfig, ScoredAgent
    │
    └── route-discovery/         — OSRM Table-based route matrix resolver
        ├── interfaces/
        │   └── router.interface.ts — IRouteResolutionRouter, IRouteMatrixResolver, IOsrmClient, RouteMatrix
        ├── router/
        │   └── osrm.router.ts     — OsrmTableResolver: IRouteMatrixResolver (batch matrix)
        ├── services/
        │   ├── agent-route-discovery.service.ts — AgentRouteCalculator (per-agent /route calls)
        │   └── osrm-client.service.ts           — OsrmClient: IOsrmClient (circuit-breaker HTTP)
        └── types/
            └── route-discovery.type.ts — RouteSummary, RouteCandidate
```

---

## 4. End-to-End Workflow

### 4.1 `dispatch.v1.request-creation` → Candidate Selection + ETA

This is the **primary flow** — triggered when the orchestrator saga decides a
delivery must be dispatched.

```
Orchestrator                   DispatchCommandQueue            EtaService
     │                                │                            │
     │─ dispatch.v1.request-creation─►│                            │
     │                                │─ calculateForDispatch() ──►│
     │                                │                            │
     │                                │              ProgressiveCandidateDiscovery
     │                                │              │─ geoSearch(2 km) → Redis
     │                                │              │─ pipeline.hgetall(agents)
     │                                │              │─ filter: AVAILABLE + connected
     │                                │              │─ [if < pool] geoSearch(5 km) → ...
     │                                │              │─ [if < pool] geoSearch(7 km) → ...
     │                                │              └─ return EligibleAgent[]
     │                                │                            │
     │                                │              AgentRankingService
     │                                │              │─ score(rating, cancellation, quota, distance)
     │                                │              └─ sort descending → RankingResult
     │                                │                            │
     │                                │              OsrmTableResolver (via OsrmClient)
     │                                │              │─ POST /table/v1/driving/...
     │                                │              │─ parse durations[] + distances[]
     │                                │              └─ return RouteMatrix
     │                                │                            │
     │                                │              filter: totalDistance ≤ 15 km
     │                                │              filter: totalEta ≤ 60 min
     │                                │              └─ return CandidatesFromMatrix[]
     │                                │                            │
     │                       [no candidates]         [candidates found]
     │◄── dispatch.v1.creation-rejected│               (TODO: rank, create, publish)
     │                                │─ dispatch.v1.created ─────────────────────►│ (pending)
```

> **Note:** The final `dispatch.v1.created` publish (with ranked agent, ETA,
> and polyline) is a **TODO** in `handleCreateCommand`. The infrastructure
> (routing, scoring, matrix) is fully wired — only the final event assembly
> remains.

### 4.2 `dispatch.v1.request-agent-selection` → Agent Notification

```
Orchestrator                   DispatchCommandQueue
     │                                │
     │─ dispatch.v1.request-agent-selection ──►│
     │                                │ publish agent.v1.notified (agent_id: 'pending')
     │◄───── agent.v1.notified ───────│
```

Agent push notifications (WebSocket via realtime-gateway) are a
**planned integration** — see [realtime-gateway](../realtime-gateway).

### 4.3 `dispatch.v1.confirm-agent-assignment` → Assignment Confirmed

```
Orchestrator                   DispatchCommandQueue
     │                                │
     │─ dispatch.v1.confirm-agent-assignment ──►│
     │                                │ publish agent.v1.assigned
     │◄───── agent.v1.assigned ───────│
```

---

## 5. Event Contract

### Inbound Commands (subscribed on `dispatch-engine.commands.queue`)

| Routing Key | Interface | Description |
|---|---|---|
| `dispatch.v1.request-creation` | `DispatchCreateCommand` | Start candidate discovery + ETA calculation for an order |
| `dispatch.v1.request-agent-selection` | `DispatchAgentSelectionCommand` | Notify nearby agents; wait for acceptance |
| `dispatch.v1.confirm-agent-assignment` | `DispatchAgentAssignmentCommand` | Confirm which agent was assigned |

### Outbound Events (published to `dispatch.exchange`)

| Routing Key | Interface | Trigger |
|---|---|---|
| `dispatch.v1.created` | `DispatchCreatedEvent` | Candidates found; ETA computed *(pending full impl.)* |
| `dispatch.v1.creation-rejected` | *(inline object)* | No eligible agents found within all search radii |
| `agent.v1.notified` | `AgentNotifiedEvent` | Agents have been notified of available dispatch |
| `agent.v1.assigned` | `AgentAssignedEvent` | Agent assignment confirmed |

All types are defined in [`src/modules/eta/types/events.ts`](./src/modules/eta/types/events.ts).

---

## 6. Internal Dependency Graph

```
DispatchCommandQueue
  ├─ IEventBus (RabbitMQBus)
  ├─ EtaService
  │    ├─ IRouteMatrixResolver (OsrmTableResolver)
  │    │    └─ IOsrmClient (OsrmClient) ──► OSRM /table/v1 HTTP (circuit-breaker)
  │    ├─ EtaConfig { maxTotalDistanceMeters, maxTotalEtaSeconds }
  │    ├─ EtaAggregatorService
  │    │    └─ IDriverMetricsProvider (DriverMetricsProvider) ── stub
  │    ├─ ProgressiveCandidateDiscovery
  │    │    └─ CacheService (Redis) ── location:delivery-agents (GEOSEARCH)
  │    │                              ── delivery-agent:{id} (HGETALL pipeline)
  │    └─ AgentRankingService
  │         ├─ RankingStrategy (SortTankingStrategy)
  │         └─ DeliveryAgentScoring
  └─ ICacheService (read-only; passed through to queue for future use)
```

---

## 7. Key Design Decisions

### Progressive Candidate Discovery

Three geo-search radii are attempted in order — **2 km → 5 km → 7 km**
([`search-level.constant.ts`](./src/modules/candidate-discovery/constants/search-level.constant.ts)).
Each level is only executed if the pool hasn't reached `MAX_CANDIDATE_POOL`
(15). Previously discovered agent IDs are tracked in a `Set` to avoid
duplicate session lookups. Session data is fetched via a single Redis pipeline
per level, not N individual calls.

### OSRM Table over per-Agent /route Calls

Instead of one HTTP call per agent (as the now-commented-out `OsrmRouter`
did), the engine uses the **OSRM Table endpoint** in a single batch request.
This reduces HTTP round-trips from O(N) to O(1) per dispatch event.

### Circuit Breaker on OSRM

`OsrmClient` wraps `fetchTable` with
[opossum](https://github.com/nodeshift/opossum):

| Setting | Value | Reason |
|---|---|---|
| `timeout` | 5 000 ms | OSRM must respond quickly to keep the saga moving |
| `errorThresholdPercentage` | 50 % | Open circuit after sustained failures |
| `resetTimeout` | 30 000 ms | Probe OSRM after 30 s |

When the circuit is open the command handler will throw and the RabbitMQ
consumer will **nack** the message, routing it to the DLQ.

### ETA Threshold Filtering

### ETA Threshold Filtering & Config Persistence

After OSRM matrix calculation, candidates exceeding `maxTotalDistanceMeters` (default: 15 km) or `maxTotalEtaSeconds` (default: 3600 s) are filtered. Thresholds, ranking weights, batch size, and candidate pool limit are dynamically fetched from the `dispatch_config` table via `DispatchConfigService` (falling back to hardcoded defaults if DB row absent).

### PostgreSQL State Persistence

- **`dispatches`**: Tracks dispatch lifecycle (`id`, `order_id`, `restaurant_id`, `status`: `REQUESTED|SEARCHING|OFFERING|ASSIGNED|COMPLETED|FAILED|CANCELLED`, `assigned_driver_id`, `current_batch`, `restaurant_to_customer_eta_seconds`).
- **`dispatch_candidates`**: Stores Top-K candidate discovery records (`dispatch_id`, `driver_id`, `batch_number`, `redis_distance_meters`, `osrm_distance_meters`, `osrm_duration_seconds`, `pre_eta_seconds`, `ranking_score`, `offer_status`: `PENDING|OFFERED|ACCEPTED|REJECTED|TIMED_OUT`).
- **`dispatch_config`**: Stores runtime threshold configuration & ranking weights (`max_total_distance_meters`, `max_total_eta_seconds`, `ranking_weights`, `batch_size`, `candidate_pool_size`).

### Ranking Signals & Redis Integration

`DeliveryAgentScoring` computes a weighted score using dynamic weights:

| Signal | Default Weight | Description |
|---|---|---|
| `rating` | 0.35 | Driver rating [0, 5] |
| `cancellationRatio` | 0.15 | Inverted cancellation ratio |
| `quota` | 0.25 | Inverted quota utilization |
| `distance` | 0.25 | Inverted distance score |

Driver metadata (`rating`, `cancellationRatio`, `quota`) is dynamically resolved from Redis (`delivery-agent:{driverId}`) by `DriverMetadataResolver`, falling back to standard defaults if unpopulated.

### RabbitMQ Ack / Nack Strategy & Tracing

- Handler **acks** AMQP messages on success.
- Handler **nacks with `requeue: false`** on unhandled errors, routing to DLQ (`dispatch.exchange.dlq`).
- OpenTelemetry trace context is injected on AMQP `publish()` inside `trace` header properties and extracted in `DispatchCommandQueue.handleCommand()` via `ContextPropagation`.

### Graceful Shutdown

`server.ts` traps `SIGTERM` / `SIGINT`, calls `EtaModuleHandle.destroy()` which disconnects RabbitMQ channel and closes TypeORM `DataSource` database connections gracefully.

---

## 8. Configuration Reference

All values read from `.env` and validated by Zod in [`src/config/envs.ts`](./src/config/envs.ts):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | HTTP server port |
| `NODE_ENV` | `development` | Runtime environment |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `RABBITMQ_URL` | `amqp://localhost:5672` | RabbitMQ connection string |
| `RABBITMQ_USER` | *(optional)* | RabbitMQ username |
| `RABBITMQ_PASS` | *(optional)* | RabbitMQ password |
| `RABBITMQ_HEARTBEAT` | `60` | AMQP heartbeat in seconds |
| `DB_HOST` | `localhost` | PostgreSQL database host |
| `DB_PORT` | `5432` | PostgreSQL database port |
| `DB_USERNAME` | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | `postgres` | PostgreSQL password |
| `DB_NAME` | `dispatch_db` | PostgreSQL database name |

---

## 9. Observability

| Concern | Implementation |
|---|---|
| **Structured logging** | `@platform/logger` — all handlers log with structured context |
| **Metrics** | `prom-client` — default Node.js metrics exposed at `GET /metrics` |
| **Tracing** | OpenTelemetry via `@platform/tracing` & `ContextPropagation` header injection/extraction |
| **Circuit-breaker state** | `opossum` events logged as warn/info |

---

## 10. Cross-Service Backlinks

### → [workflow-orchestrator](../workflow-orchestrator)

- Sends **inbound commands** on `dispatch.exchange`.
- Receives **outbound events** (`dispatch.v1.created`, `dispatch.v1.creation-rejected`, `agent.v1.assigned`) to advance saga steps.
- Coordinates candidate batching re-try/timeout loops: when current offered batch times out or all candidates reject, orchestrator triggers next batch or marks dispatch failed.

### → [realtime-gateway](../realtime-gateway)

- **Shared Redis state**: Writes driver positions to `location:delivery-agents` and session data to `delivery-agent:{id}`.
- **WebSocket notification**: `realtime-gateway` consumes notification events to send driver app WS updates.


---


## 11. Improvement: Movement-Aware Candidate Pre-Filtering

### Problem

The current candidate flow performs Redis-based candidate discovery followed by OSRM Table route resolution. OSRM is the expensive step because it evaluates the route and ETA for the shortlisted agents.

A candidate may be geographically close to the restaurant but currently moving strongly away from it. Sending such candidates to OSRM can consume route-matrix capacity on agents that are unlikely to be useful.

The goal of this optimization is **not to replace OSRM route resolution**, but to cheaply eliminate obviously poor candidates before making the OSRM request.

### Proposed Flow

The candidate pipeline can be extended as follows:

```text
Redis GEOSEARCH
      |
      v
Cheap eligibility filters
      |
      +-- AVAILABLE?
      +-- connected?
      +-- location fresh?
      +-- movement direction strongly away?
      |
      v
Movement-aware candidate shortlist
      |
      v
Agent ranking
      |
      v
OSRM Table
      |
      v
Actual route distance + ETA
      |
      v
Final candidate filtering
```

### Movement Direction Signal

The realtime-gateway already writes delivery-agent location state to Redis. The dispatch engine can use the current and previous location samples to derive an approximate movement vector.

Required location information:

```text
current_lat
current_lng
previous_lat
previous_lng
last_location_at
previous_location_at
```

From these values the engine can derive:

```text
movement_vector
agent_to_restaurant_vector
```

and compare their alignment.

Conceptually:

```text
+1  -> strongly moving toward restaurant
 0  -> approximately perpendicular / uncertain
-1  -> strongly moving away from restaurant
```

This is a **cheap heuristic**, not a replacement for route calculation.

### Conservative Filtering

The engine should not reject every agent that is temporarily moving away from the restaurant. Real road networks can require turns, U-turns, one-way roads, or temporary movement away from the destination.

A candidate should only be removed when the evidence strongly suggests that the agent is unlikely to be useful.

For example:

```text
if:
    movement is strongly away
    AND location is sufficiently far from restaurant
    AND away movement persists across multiple location updates
then:
    exclude candidate before OSRM
```

Candidates should generally be retained when:

* movement is only slightly away from the restaurant;
* movement direction is uncertain;
* the agent is already very close to the restaurant;
* there are insufficient recent location samples;
* the location data is stale or unreliable.

### Traffic / Route Consideration

Movement direction must not become the source of truth for ETA.

For example:

```text
Agent A:
  moving toward restaurant
  heavy traffic
  actual route ETA = 12 minutes

Agent B:
  currently moving away
  can turn around / has a better route
  actual route ETA = 5 minutes
```

Agent B should still be eligible if it survives the conservative pre-filter.

Therefore:

```text
Movement direction
       |
       | cheap heuristic
       v
Candidate reduction
       |
       v
OSRM
       |
       | authoritative route/ETA calculation
       v
Final candidate decision
```

### Expected Benefit

This optimization reduces the number of candidates passed to OSRM without requiring an additional external routing call.

For example:

```text
Redis discovery       30 candidates
        |
        v
Movement pre-filter   18 candidates
        |
        v
OSRM Table            18 candidates
```

Instead of sending all 30 candidates to OSRM, the engine can eliminate candidates that are clearly moving away before the expensive route-matrix calculation.

The optimization is therefore primarily intended to **reduce OSRM API usage and route-resolution cost while preserving route-based ETA accuracy for candidates that remain eligible**.

### Design Principle

> Use cheap local signals to reduce the candidate set; use OSRM to make the actual route and ETA decision.

Movement direction should remain a **pre-filtering heuristic**, not a hard source of truth for dispatch decisions.
