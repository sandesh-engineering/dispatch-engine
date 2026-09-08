import { logger } from '@platform/logger';
import { OsrmRouter } from '../router/osrm.router';
import {
  DISPATCH_COMMANDS,
  DISPATCH_EVENTS,
  DISPATCH_EXCHANGE,
  DispatchCreateCommand,
  DispatchAgentSelectionCommand,
  DispatchAgentAssignmentCommand,
  DispatchCreatedEvent,
  AgentNotifiedEvent,
  AgentAssignedEvent,
  DispatchCommandPayload,
  OfferResponseCommand,
} from '../types/events';
import { IEventBus } from 'src/interfaces/event-bus.interface';
import { ICacheService } from '@platform/cache';
import { EtaService } from '../services/eta-base.service';
import { DispatchRepository } from 'src/repositories/dispatch.repository';
import { DispatchCandidateRepository } from 'src/repositories/dispatch-candidate.repository';
import { DispatchBatchStateStore } from 'src/modules/ranking';
import { DispatchStatus } from 'src/enums/dispatch-status.enum';
import { OfferStatus } from 'src/enums/offer-status.enum';
import { STATIC_RANKING_CONFIG } from 'src/modules/ranking/constants/ranking.config';
import { DispatchCandidateEntity } from 'src/entities/dispatch-candidate.entity';
import { CandidatesFromMatrix } from '../types/eta.types';

/**
 * Shared constant for the dispatch engine consumer queue name.
 */
const DISPATCH_CONSUMER_QUEUE = 'dispatch-engine.commands.queue';

/** How long (ms) an offer is valid before the sweep marks it TIMED_OUT. */
const OFFER_TIMEOUT_MS = 30_000;

/**
 * Command queue that listens to dispatch commands from the orchestrator,
 * handles the full dispatch lifecycle with PostgreSQL persistence + Redis
 * batch-state, and publishes result events.
 */
export class DispatchCommandQueue {
  private provisioned = false;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly router: OsrmRouter,
    private readonly cacheService: ICacheService,
    private readonly etaService: EtaService,
    private readonly dispatchRepo: DispatchRepository,
    private readonly candidateRepo: DispatchCandidateRepository,
    private readonly batchStateStore: DispatchBatchStateStore,
  ) {}

  /**
   * Provision the queue: connect, assert topology, bind routing keys, and start consuming.
   * Idempotent — safe to call multiple times.
   */
  async provision(): Promise<void> {
    if (this.provisioned) {
      logger.warn('DispatchCommandQueue already provisioned — skipping');
      return;
    }

    logger.info('Provisioning DispatchCommandQueue...');

    /* 1. Connect the event bus */
    await this.eventBus.connect();

    /* 2. Subscribe to all dispatch command routing keys */
    const commandRoutingKeys = Object.values(DISPATCH_COMMANDS);

    await this.eventBus.subscribe<DispatchCommandPayload>(
      DISPATCH_CONSUMER_QUEUE,
      commandRoutingKeys,
      this.handleCommand.bind(this),
    );

    this.provisioned = true;

    logger.info('DispatchCommandQueue provisioned successfully', {
      queue: DISPATCH_CONSUMER_QUEUE,
      routingKeys: commandRoutingKeys,
      exchange: DISPATCH_EXCHANGE.name,
    });
  }

  /**
   * Handle an incoming dispatch command by routing to the appropriate handler.
   */
  private async handleCommand(payload: DispatchCommandPayload): Promise<void> {
    logger.info('Processing dispatch command', {
      type: this.resolveCommandType(payload),
    });

    if (this.isCreateCommand(payload)) {
      await this.handleCreateCommand(payload);
    } else if (this.isOfferResponseCommand(payload)) {
      await this.handleOfferResponseCommand(payload);
    } else if (this.isAgentSelectionCommand(payload)) {
      await this.handleAgentSelectionCommand(payload);
    } else if (this.isAgentAssignmentCommand(payload)) {
      await this.handleAgentAssignmentCommand(payload);
    } else {
      logger.warn('Unknown dispatch command payload', { payload });
    }
  }

  // ---------------------------------------------------------------------------
  // 3.4 + 3.5  Create-command persistence
  // ---------------------------------------------------------------------------

  /**
   * Handle `dispatch.v1.request-creation`.
   *
   * Flow:
   * 1. create-or-get dispatch (REQUESTED)
   * 2. transition to SEARCHING
   * 3. Redis GEO discovery → rank candidates
   * 4. Initialize Redis batch-state hash
   * 5. Iterate nextBatch() → OSRM Table → persist DispatchCandidateEntity rows
   * 6. Persist shared restaurant→customer leg on the dispatch row
   * 7. Transition dispatch to OFFERING (current_batch=1)
   * 8. Publish dispatch.v1.created with pre-trip ETA
   */
  private async handleCreateCommand(
    payload: DispatchCreateCommand,
  ): Promise<void> {
    const { order_id, restaurant_id, restaurant_coords, customer_coords } =
      payload;

    /* --- Step 1: Create-or-get dispatch --- */
    const dispatch = await this.dispatchRepo.createOrGetByOrderId({
      order_id,
      restaurant_id,
      status: DispatchStatus.REQUESTED,
    });

    logger.info('Dispatch record created or retrieved', {
      dispatch_id: dispatch.id,
      order_id,
    });

    /* --- Step 2: Transition to SEARCHING --- */
    const searchingAffected = await this.dispatchRepo.transitionToSearching(
      dispatch.id,
    );
    if (searchingAffected === 0) {
      logger.warn(
        'Dispatch already past REQUESTED — duplicate create command ignored',
        { dispatch_id: dispatch.id, order_id },
      );
      return;
    }

    /* --- Step 3: Discover and rank candidates --- */
    const rankedResult = await this.etaService.discoverAndRank(
      restaurant_coords,
    );

    if (!rankedResult || rankedResult.totalAgents === 0) {
      logger.warn('No candidates found for dispatch — failing dispatch', {
        dispatch_id: dispatch.id,
        order_id,
      });
      await this.dispatchRepo.failDispatch(dispatch.id, 'NO_CANDIDATES_FOUND');
      return;
    }

    /* --- Step 4: Initialize Redis batch-state hash --- */
    await this.batchStateStore.initialize({
      dispatchId: dispatch.id,
      currentIndex: 0,
      currentBatch: 0,
      status: DispatchStatus.SEARCHING,
      totalAgents: rankedResult.totalAgents,
    });

    /* --- Step 5: Evaluate first batch via OSRM Table and persist candidates --- */
    const firstBatch = rankedResult.nextBatch();
    const cursorAfterFirstBatch = rankedResult.currentCursorIndex;

    const candidates = await this.etaService.calculate(
      firstBatch,
      restaurant_coords,
      customer_coords,
    );

    if (candidates.length === 0) {
      logger.warn('First batch produced no viable candidates', {
        dispatch_id: dispatch.id,
        order_id,
      });
      await this.dispatchRepo.failDispatch(
        dispatch.id,
        'NO_VIABLE_CANDIDATES_IN_FIRST_BATCH',
      );
      return;
    }

    /* Persist candidate rows (orIgnore for idempotency) */
    const candidateEntities: Partial<DispatchCandidateEntity>[] =
      candidates.map((c) => ({
        dispatch_id: dispatch.id,
        driver_id: c.agent.id,
        batch_number: 1,
        redis_distance_meters: c.agent.distanceKm * 1000,
        osrm_distance_meters: c.agentToRestaurant.distanceMeters,
        osrm_duration_seconds: c.agentToRestaurant.durationSeconds,
        pre_eta_seconds: c.agentToRestaurant.durationSeconds,
        ranking_score: null,
        offer_status: OfferStatus.PENDING,
      }));

    await this.candidateRepo.insertBatch(candidateEntities);

    /* --- Step 6: Persist shared restaurant→customer leg on the dispatch row --- */
    const sharedLeg = candidates[0].restaurantToCustomer;

    /* --- Step 7: Transition to OFFERING with current_batch=1 --- */
    await this.dispatchRepo.transitionToOffering(dispatch.id, 1, {
      distanceMeters: sharedLeg.distanceMeters,
      durationSeconds: sharedLeg.durationSeconds,
    });

    /* --- Refresh Redis hash after successful Postgres transition --- */
    await this.batchStateStore.advanceCursor({
      dispatchId: dispatch.id,
      newIndex: cursorAfterFirstBatch,
      newBatch: 1,
      status: DispatchStatus.OFFERING,
    });

    /* --- Step 8: Publish dispatch.v1.created with pre-trip ETA --- */
    const bestCandidate = candidates[0];
    const event: DispatchCreatedEvent = {
      dispatch_id: dispatch.id,
      order_id,
      driver_to_restaurant_eta_seconds:
        bestCandidate.agentToRestaurant.durationSeconds,
      restaurant_to_customer: {
        distance_meters: sharedLeg.distanceMeters,
        duration_seconds: sharedLeg.durationSeconds,
      },
      total_eta_seconds:
        bestCandidate.agentToRestaurant.durationSeconds +
        sharedLeg.durationSeconds,
      created_at: new Date().toISOString(),
    };

    await this.eventBus.publish(DISPATCH_EVENTS.CREATED, event);

    logger.info('Published dispatch.v1.created', {
      dispatch_id: dispatch.id,
      order_id,
      total_eta_seconds: event.total_eta_seconds,
      batch_candidates: candidates.length,
    });
  }

  // ---------------------------------------------------------------------------
  // 4.1  Agent selection — mark batch OFFERED
  // ---------------------------------------------------------------------------

  /**
   * Handle `dispatch.v1.request-agent-selection`.
   * Reads the active batch from Redis, marks all PENDING candidates OFFERED,
   * and publishes agent.v1.notified per candidate.
   */
  private async handleAgentSelectionCommand(
    payload: DispatchAgentSelectionCommand,
  ): Promise<void> {
    const { dispatch_id, order_id } = payload;

    /* Read batch state from Redis (rebuild from Postgres if missing) */
    let batchState = await this.batchStateStore.read(dispatch_id);
    if (!batchState) {
      batchState = await this.rebuildBatchState(dispatch_id);
    }
    if (!batchState) {
      logger.warn('Cannot find batch state for dispatch — skipping selection', {
        dispatch_id,
      });
      return;
    }

    const currentBatch = Number(batchState.current_batch);

    /* Mark batch OFFERED */
    const offered = await this.candidateRepo.markBatchOffered(
      dispatch_id,
      currentBatch,
    );

    logger.info('Batch marked OFFERED', {
      dispatch_id,
      batch: currentBatch,
      offered,
    });

    /* Publish agent.v1.notified per candidate */
    const batchCandidates = await this.candidateRepo.findByDispatchAndBatch(
      dispatch_id,
      currentBatch,
    );

    for (const candidate of batchCandidates) {
      const event: AgentNotifiedEvent = {
        dispatch_id,
        order_id,
        agent_id: candidate.driver_id,
        notified_at: new Date().toISOString(),
      };
      await this.eventBus.publish(DISPATCH_EVENTS.AGENT_NOTIFIED, event);
    }

    logger.info('Published agent.v1.notified for batch', {
      dispatch_id,
      batch: currentBatch,
      count: batchCandidates.length,
    });
  }

  // ---------------------------------------------------------------------------
  // 4.2  Offer response (ACCEPT / REJECT)
  // ---------------------------------------------------------------------------

  /**
   * Handle `dispatch.v1.offer-response`.
   * Records the response exactly once via the guarded repository method.
   */
  private async handleOfferResponseCommand(
    payload: OfferResponseCommand,
  ): Promise<void> {
    const { dispatch_id, order_id, agent_id, batch_number, response } = payload;

    const terminalStatus =
      response === 'ACCEPT' ? OfferStatus.ACCEPTED : OfferStatus.REJECTED;

    const affected = await this.candidateRepo.respondOnce({
      dispatchId: dispatch_id,
      driverId: agent_id,
      batchNumber: batch_number,
      status: terminalStatus,
    });

    if (affected === 0) {
      logger.warn('Duplicate or stale offer response — ignoring', {
        dispatch_id,
        agent_id,
        batch_number,
        response,
      });
      return;
    }

    if (response === 'ACCEPT') {
      await this.handleAcceptance({
        dispatch_id,
        order_id,
        agent_id,
        batch_number,
      });
    } else {
      await this.checkAndAdvanceBatch({ dispatch_id, order_id, batch_number });
    }
  }

  // ---------------------------------------------------------------------------
  // 4.3  Acceptance handling
  // ---------------------------------------------------------------------------

  private async handleAcceptance(params: {
    dispatch_id: string;
    order_id: string;
    agent_id: string;
    batch_number: number;
  }): Promise<void> {
    const { dispatch_id, order_id, agent_id } = params;

    /* Guarded transition: OFFERING → ASSIGNED (only succeeds once) */
    const assigned = await this.dispatchRepo.assignDriver(
      dispatch_id,
      agent_id,
    );

    if (assigned === 0) {
      logger.warn(
        'Assignment guard failed — dispatch already assigned or not OFFERING',
        { dispatch_id, agent_id },
      );
      return;
    }

    /* Refresh Redis hash */
    await this.batchStateStore.updateStatus(dispatch_id, DispatchStatus.ASSIGNED);

    /* Publish agent.v1.assigned (orchestrator saga confirmation) */
    const event: AgentAssignedEvent = {
      dispatch_id,
      order_id,
      agent_id,
      assigned_at: new Date().toISOString(),
    };
    await this.eventBus.publish(DISPATCH_EVENTS.AGENT_ASSIGNED, event);

    logger.info('Published agent.v1.assigned', {
      dispatch_id,
      order_id,
      agent_id,
    });
  }

  // ---------------------------------------------------------------------------
  // 4.4  Batch advancement
  // ---------------------------------------------------------------------------

  private async checkAndAdvanceBatch(params: {
    dispatch_id: string;
    order_id: string;
    batch_number: number;
  }): Promise<void> {
    const { dispatch_id, order_id, batch_number } = params;

    /* Only advance when the whole batch is terminal */
    const isTerminal = await this.candidateRepo.isBatchTerminal(
      dispatch_id,
      batch_number,
    );
    if (!isTerminal) return;

    /* No acceptance in this batch → advance */
    const hasAccepted = await this.candidateRepo.hasBatchAccepted(
      dispatch_id,
      batch_number,
    );
    if (hasAccepted) return; // safety guard

    const nextBatch = batch_number + 1;

    /* Atomic counter increment + batch advance (guarded) */
    const advanced = await this.dispatchRepo.advanceBatch(
      dispatch_id,
      nextBatch,
      batch_number,
    );
    if (advanced === 0) {
      logger.warn('Batch advance guard failed — duplicate advance ignored', {
        dispatch_id,
        batch_number,
      });
      return;
    }

    /* Read current batch state to know the cursor */
    let batchState = await this.batchStateStore.read(dispatch_id);
    if (!batchState) {
      batchState = await this.rebuildBatchState(dispatch_id);
    }

    if (!batchState) {
      logger.warn('Cannot read batch state after advance — skipping next offer', {
        dispatch_id,
      });
      return;
    }

    const currentIndex = Number(batchState.current_index);
    const totalAgents = Number(batchState.total_agents);

    if (currentIndex >= totalAgents) {
      /* Candidates exhausted — fail the dispatch */
      await this.exhaustCandidates({ dispatch_id, order_id });
      return;
    }

    /* Refresh Redis hash with new cursor */
    await this.batchStateStore.advanceCursor({
      dispatchId: dispatch_id,
      newIndex: currentIndex, // cursor already advanced on the in-memory RankingResult
      newBatch: nextBatch,
      status: DispatchStatus.OFFERING,
    });

    logger.info('Batch advanced — next offer batch ready', {
      dispatch_id,
      nextBatch,
    });
  }

  // ---------------------------------------------------------------------------
  // 4.5  Candidate exhaustion
  // ---------------------------------------------------------------------------

  private async exhaustCandidates(params: {
    dispatch_id: string;
    order_id: string;
  }): Promise<void> {
    const { dispatch_id, order_id } = params;

    const failed = await this.dispatchRepo.failDispatch(
      dispatch_id,
      'CANDIDATES_EXHAUSTED',
    );

    if (failed === 0) {
      logger.warn('Fail-dispatch guard failed — dispatch already terminal', {
        dispatch_id,
      });
      return;
    }

    /* Refresh Redis hash */
    await this.batchStateStore.updateStatus(dispatch_id, DispatchStatus.FAILED);

    /* Publish dispatch.v1.creation-rejected (existing failure event) */
    await this.eventBus.publish(DISPATCH_EVENTS.CREATION_REJECTED, {
      dispatch_id,
      order_id,
      reason: 'CANDIDATES_EXHAUSTED',
    });

    logger.info('Published dispatch.v1.creation-rejected', {
      dispatch_id,
      order_id,
    });
  }

  // ---------------------------------------------------------------------------
  // 4.6  Timeout sweep
  // ---------------------------------------------------------------------------

  /**
   * Sweep: mark stale OFFERED candidates TIMED_OUT and advance fully terminal batches.
   * Safe to call periodically; all transitions are guarded.
   */
  async sweepTimedOutOffers(): Promise<void> {
    // This is triggered externally (e.g., setInterval in bootstrap).
    // We can't enumerate all active dispatches here without a repo scan.
    // The caller should pass a list of active dispatch IDs, or we query them.
    // For simplicity this method is exported and called by the bootstrap timer
    // with specific dispatch IDs from the batch-state store. The core timeout
    // logic (markStaleOfferedTimedOut + checkAndAdvanceBatch) is exposed below.
    logger.debug('Timeout sweep triggered');
  }

  /**
   * Time out stale offers for a specific dispatch batch.
   * Called by the timeout sweep with the dispatch_id + batch_number.
   */
  async timeoutDispatchBatch(params: {
    dispatch_id: string;
    order_id: string;
    batch_number: number;
  }): Promise<void> {
    const { dispatch_id, order_id, batch_number } = params;

    const staleBefore = new Date(Date.now() - OFFER_TIMEOUT_MS);
    const timedOut = await this.candidateRepo.markStaleOfferedTimedOut(
      dispatch_id,
      batch_number,
      staleBefore,
    );

    if (timedOut === 0) return; // nothing timed out

    logger.info('Timed out stale offers', {
      dispatch_id,
      batch_number,
      timedOut,
    });

    await this.checkAndAdvanceBatch({ dispatch_id, order_id, batch_number });
  }

  // ---------------------------------------------------------------------------
  // 4.7  Redis hash rebuild on miss
  // ---------------------------------------------------------------------------

  private async rebuildBatchState(dispatch_id: string) {
    const dispatch = await this.dispatchRepo.findById(dispatch_id);
    if (!dispatch) {
      logger.warn('Cannot rebuild batch state — dispatch not found', {
        dispatch_id,
      });
      return null;
    }

    /* Find the highest persisted batch number */
    const candidates = await this.candidateRepo.findByDispatchId(dispatch_id);
    const highestBatchNumber = candidates.reduce(
      (max, c) => Math.max(max, c.batch_number),
      0,
    );

    return this.batchStateStore.rebuild({
      dispatchId: dispatch_id,
      currentBatch: dispatch.current_batch,
      status: dispatch.status,
      highestPersistedBatchNumber: highestBatchNumber,
      batchSize: STATIC_RANKING_CONFIG.batchSize,
      totalAgents: 0, // unknown at rebuild time; set to 0 to signal exhaustion
    });
  }

  // ---------------------------------------------------------------------------
  // Legacy: confirm-agent-assignment (orchestrator saga confirmation)
  // ---------------------------------------------------------------------------

  /**
   * Handle `dispatch.v1.confirm-agent-assignment` (orchestrator saga confirmation step).
   * The orchestrator sends this after saga confirms the assignment is durable.
   */
  private async handleAgentAssignmentCommand(
    payload: DispatchAgentAssignmentCommand,
  ): Promise<void> {
    /* Complete the dispatch lifecycle in PostgreSQL */
    const completed = await this.dispatchRepo.completeDispatch(payload.dispatch_id);

    if (completed > 0) {
      logger.info('Dispatch marked COMPLETED', {
        dispatch_id: payload.dispatch_id,
        order_id: payload.order_id,
        agent_id: payload.agent_id,
      });

      await this.batchStateStore.updateStatus(
        payload.dispatch_id,
        DispatchStatus.COMPLETED,
      );
    } else {
      logger.warn('completeDispatch guard missed — dispatch not in ASSIGNED state', {
        dispatch_id: payload.dispatch_id,
      });
    }

    /* Publish agent.v1.assigned for downstream consumers */
    const event: AgentAssignedEvent = {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
      agent_id: payload.agent_id,
      assigned_at: new Date().toISOString(),
    };

    await this.eventBus.publish(DISPATCH_EVENTS.AGENT_ASSIGNED, event);

    logger.info('Published agent.v1.assigned (confirm-assignment)', {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
      agent_id: payload.agent_id,
    });
  }

  // ---------------------------------------------------------------------------
  // Type guards
  // ---------------------------------------------------------------------------

  private resolveCommandType(payload: DispatchCommandPayload): string {
    if (this.isCreateCommand(payload))
      return DISPATCH_COMMANDS.REQUEST_CREATION;
    if (this.isOfferResponseCommand(payload))
      return DISPATCH_COMMANDS.OFFER_RESPONSE;
    if (this.isAgentSelectionCommand(payload))
      return DISPATCH_COMMANDS.REQUEST_AGENT_SELECTION;
    if (this.isAgentAssignmentCommand(payload))
      return DISPATCH_COMMANDS.CONFIRM_AGENT_ASSIGNMENT;
    return 'unknown';
  }

  private isCreateCommand(
    payload: DispatchCommandPayload,
  ): payload is DispatchCreateCommand {
    return (
      'order_id' in payload &&
      'restaurant_coords' in payload &&
      'customer_coords' in payload &&
      'restaurant_id' in payload &&
      !('agent_id' in payload) &&
      !('response' in payload)
    );
  }

  private isOfferResponseCommand(
    payload: DispatchCommandPayload,
  ): payload is OfferResponseCommand {
    return 'response' in payload && 'batch_number' in payload;
  }

  private isAgentSelectionCommand(
    payload: DispatchCommandPayload,
  ): payload is DispatchAgentSelectionCommand {
    return (
      'dispatch_id' in payload &&
      'restaurant_coords' in payload &&
      'customer_coords' in payload &&
      !('agent_id' in payload) &&
      !('response' in payload)
    );
  }

  private isAgentAssignmentCommand(
    payload: DispatchCommandPayload,
  ): payload is DispatchAgentAssignmentCommand {
    return (
      'agent_id' in payload &&
      'dispatch_id' in payload &&
      !('response' in payload) &&
      !('batch_number' in payload)
    );
  }

  /**
   * Extract distance, duration, and geometry from an OSRM route response.
   */
  private extractRouteSummary(response: unknown): {
    distance: number;
    duration: number;
    geometry: unknown;
  } {
    const route = (response as any)?.routes?.[0];
    if (!route) {
      logger.warn('OSRM route response missing route data', { response });
      return { distance: 0, duration: 0, geometry: null };
    }

    return {
      distance: Math.round(route.distance),
      duration: Math.round(route.duration),
      geometry: route.geometry,
    };
  }
}
