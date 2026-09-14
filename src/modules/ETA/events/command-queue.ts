import { logger } from '@platform/logger';
import { withSpan, trace, context } from '@platform/tracing';
import { ContextPropagation } from 'src/tracing/propagation/context';
import {
  DISPATCH_COMMANDS,
  DISPATCH_EVENTS,
  DISPATCH_EXCHANGE,
  DispatchCreateCommand,
  DispatchAgentSelectionCommand,
  DispatchAgentAssignmentCommand,
  AgentNotifiedEvent,
  AgentAssignedEvent,
  DispatchCommandPayload,
  DispatchCreatedEvent,
} from '../types/events';
import { IEventBus } from 'src/interfaces/event-bus.interface';
import { ICacheService } from '@platform/cache';
import { EtaService } from '../services/eta-base.service';
import { DispatchRepository } from 'src/repositories/dispatch.repository';
import { DispatchCandidatesRepository } from 'src/repositories/dispatch-candidates.repository';
import { DispatchConfigService } from 'src/services/dispatch-config.service';
import { DispatchStatus } from 'src/entities/dispatch.entity';
import { CandidateOfferStatus } from 'src/entities/dispatch-candidate.entity';

const DISPATCH_CONSUMER_QUEUE = 'dispatch-engine.commands.queue';

export class DispatchCommandQueue {
  private provisioned = false;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly etaService: EtaService,
    private readonly cacheService: ICacheService,
    private readonly dispatchRepo: DispatchRepository,
    private readonly candidatesRepo: DispatchCandidatesRepository,
    private readonly configService: DispatchConfigService,
  ) { }

  async provision(): Promise<void> {
    if (this.provisioned) {
      logger.warn('DispatchCommandQueue already provisioned — skipping');
      return;
    }

    logger.info('Provisioning DispatchCommandQueue...');
    await this.eventBus.connect();

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

  private async handleCommand(
    payload: DispatchCommandPayload,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    const parentContext = ContextPropagation.extractContext(
      (headers?.trace as Record<string, unknown>) ?? {},
    );

    return withSpan(
      'Dispatch Handle Command',
      async () => {
        logger.info('Processing dispatch command', {
          type: this.resolveCommandType(payload),
          order_id: (payload as DispatchCreateCommand).order_id,
        });

        if (this.isCreateCommand(payload)) {
          await this.handleCreateCommand(payload);
        } else if (this.isAgentSelectionCommand(payload)) {
          await this.handleAgentSelectionCommand(payload);
        } else if (this.isAgentAssignmentCommand(payload)) {
          await this.handleAgentAssignmentCommand(payload);
        } else {
          logger.warn('Unknown dispatch command payload', { payload });
        }
      },
      parentContext,
    );
  }

  private async handleCreateCommand(
    payload: DispatchCreateCommand,
  ): Promise<void> {
    const restaurantCoords = {
      longitude: payload.restaurant_coords.longitude,
      latitude: payload.restaurant_coords.latitude,
    };

    const customerCoords = {
      longitude: payload.customer_coords.longitude,
      latitude: payload.customer_coords.latitude,
    };

    const { dispatch, candidates } = await this.etaService.calculateForDispatch(
      restaurantCoords,
      customerCoords,
      payload.order_id,
      payload.restaurant_id,
    );

    const activeSpan = trace.getSpan(context.active());
    activeSpan?.setAttributes({
      'dispatch.order_id': payload.order_id,
      'dispatch.id': dispatch.id,
      'dispatch.candidate_count': candidates.length,
      'dispatch.batch_number': dispatch.currentBatch,
    });

    if (candidates.length === 0) {
      logger.warn('No eligible candidates found — dispatch creation rejected', {
        order_id: payload.order_id,
        dispatch_id: dispatch.id,
      });

      await this.eventBus.publish(DISPATCH_EVENTS.CREATION_REJECTED, {
        order_id: payload.order_id,
        reason: 'NO_ELIGIBLE_AGENTS',
        rejected_at: new Date().toISOString(),
      });

      return;
    }

    /* Transition status: SEARCHING → OFFERING */
    await this.dispatchRepo.updateStatus(
      dispatch.id,
      DispatchStatus.SEARCHING,
      DispatchStatus.OFFERING,
      { currentBatch: 1 },
    );

    const runtimeConfig = await this.configService.getConfig();

    /* Select batch 1 candidates & batch-update DB (no N+1) */
    const firstBatchCandidates = candidates.slice(0, runtimeConfig.batchSize);
    const firstBatchDriverIds = firstBatchCandidates.map((c) => c.agent.id);

    await this.candidatesRepo.updateBatchOfferStatus(
      dispatch.id,
      firstBatchDriverIds,
      1,
      CandidateOfferStatus.OFFERED,
      { offeredAt: new Date() },
    );

    const primaryCandidate = firstBatchCandidates[0];

    const event: DispatchCreatedEvent = {
      dispatch_id: dispatch.id,
      order_id: payload.order_id,
      agent_to_restaurant: {
        distance_meters: primaryCandidate
          ? primaryCandidate.agentToRestaurant.distanceMeters
          : 0,
        duration_seconds: primaryCandidate
          ? primaryCandidate.agentToRestaurant.durationSeconds
          : 0,
        polyline: primaryCandidate?.agentToRestaurant.geometry ?? '',
      },
      restaurant_to_customer: {
        distance_meters: primaryCandidate
          ? primaryCandidate.restaurantToCustomer.distanceMeters
          : 0,
        duration_seconds: primaryCandidate
          ? primaryCandidate.restaurantToCustomer.durationSeconds
          : 0,
        polyline: primaryCandidate?.restaurantToCustomer.geometry ?? '',
      },
      total_eta_seconds: primaryCandidate ? primaryCandidate.totalEtaSeconds : 0,
      created_at: new Date().toISOString(),
    };

    await this.eventBus.publish(DISPATCH_EVENTS.CREATED, event);

    logger.info('Published dispatch.v1.created', {
      dispatch_id: dispatch.id,
      order_id: payload.order_id,
      total_eta_seconds: event.total_eta_seconds,
      batch_candidates_offered: firstBatchCandidates.length,
    });
  }

  private async handleAgentSelectionCommand(
    payload: DispatchAgentSelectionCommand,
  ): Promise<void> {
    const event: AgentNotifiedEvent = {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
      agent_id: 'pending',
      notified_at: new Date().toISOString(),
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

  private async handleAgentAssignmentCommand(
    payload: DispatchAgentAssignmentCommand,
  ): Promise<void> {
    /* Idempotent transition: OFFERING/SEARCHING → ASSIGNED */
    const updated = await this.dispatchRepo.updateStatus(
      payload.dispatch_id,
      [DispatchStatus.OFFERING, DispatchStatus.SEARCHING],
      DispatchStatus.ASSIGNED,
      {
        assignedDriverId: payload.agent_id,
        assignedAt: new Date(),
      },
    );

    if (!updated) {
      logger.info(
        'Assignment already processed or dispatch not in OFFERING/SEARCHING status — skipping',
        {
          dispatch_id: payload.dispatch_id,
          agent_id: payload.agent_id,
        },
      );
      return;
    }

    await this.candidatesRepo.updateOfferStatus(
      payload.dispatch_id,
      payload.agent_id,
      1,
      CandidateOfferStatus.ACCEPTED,
      { respondedAt: new Date() },
    );

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

  private resolveCommandType(payload: DispatchCommandPayload): string {
    if (this.isCreateCommand(payload)) return DISPATCH_COMMANDS.REQUEST_CREATION;
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
}
