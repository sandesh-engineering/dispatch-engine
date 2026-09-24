import { ICacheService } from '@platform/cache';
import { DispatchStatus } from '../../../enums/dispatch-status.enum';
import { RankableAgent } from '../../ranking';

/**
 * The shape persisted in the Redis hash `dispatch:{id}:batching`.
 */
export interface DispatchBatchState {
  /** Index into the full ranked-agent list for the next nextBatch() call */
  current_index: string;
  /** Current batch number (mirrors dispatches.current_batch) */
  current_batch: string;
  /** Dispatch lifecycle status (mirrors dispatches.status) */
  status: DispatchStatus;
  /** Total number of ranked agents */
  total_agents: string;
}

/**
 * Redis-backed store for the ranked-candidate cursor and active dispatch state.
 *
 * Key: `dispatch:{dispatchId}:batching`
 * Fields: current_index, current_batch, status, total_agents
 * TTL: covers the offer horizon (configurable, defaults to 1 hour)
 *
 * This is the OPERATIONAL fast-access layer only. PostgreSQL remains authoritative.
 */
export class DispatchBatchStateStore {
  /** Default TTL in seconds: 1 hour (covers multi-batch dispatch offer horizon) */
  private readonly DEFAULT_TTL_SECONDS = 3600;

  constructor(private readonly cacheService: ICacheService) {}

  private hashKey(dispatchId: string): string {
    return `dispatch:${dispatchId}:batching`;
  }

  /**
   * Initialize the Redis batch-state hash for a dispatch.
   * Stores the full ranked list total length and initializes cursor to 0.
   */
  async initialize(params: {
    dispatchId: string;
    currentIndex: number;
    currentBatch: number;
    status: DispatchStatus;
    totalAgents: number;
    ttlSeconds?: number;
  }): Promise<void> {
    const state: DispatchBatchState = {
      current_index: String(params.currentIndex),
      current_batch: String(params.currentBatch),
      status: params.status,
      total_agents: String(params.totalAgents),
    };

    await this.cacheService.hset(
      this.hashKey(params.dispatchId),
      state,
      params.ttlSeconds ?? this.DEFAULT_TTL_SECONDS,
    );
  }

  /**
   * Rebuild the Redis batch-state hash from PostgreSQL data.
   * Used when the hash is missing or expired.
   *
   * @param params.dispatchId - The dispatch UUID.
   * @param params.currentBatch - `dispatches.current_batch` from PostgreSQL.
   * @param params.status - `dispatches.status` from PostgreSQL.
   * @param params.highestPersistedBatchNumber - The highest batch_number in dispatch_candidates;
   *        0 if none are persisted yet. The cursor is set to advance past the persisted candidates.
   * @param params.batchSize - Ranking batch size used to compute the cursor offset.
   * @param params.totalAgents - Total number of ranked agents (used to bound the cursor).
   */
  async rebuild(params: {
    dispatchId: string;
    currentBatch: number;
    status: DispatchStatus;
    highestPersistedBatchNumber: number;
    batchSize: number;
    totalAgents: number;
    ttlSeconds?: number;
  }): Promise<DispatchBatchState> {
    // The cursor is positioned after the last persisted batch.
    // Each batch consumed `batchSize` agents from the ranked list.
    const currentIndex = Math.min(
      params.highestPersistedBatchNumber * params.batchSize,
      params.totalAgents,
    );

    const state: DispatchBatchState = {
      current_index: String(currentIndex),
      current_batch: String(params.currentBatch),
      status: params.status,
      total_agents: String(params.totalAgents),
    };

    await this.cacheService.hset(
      this.hashKey(params.dispatchId),
      state,
      params.ttlSeconds ?? this.DEFAULT_TTL_SECONDS,
    );

    return state;
  }


  /**
   * Read the batch state from Redis. Returns null if missing/expired.
   */
  async read(dispatchId: string): Promise<DispatchBatchState | null> {
    return this.cacheService.hget<DispatchBatchState>(
      this.hashKey(dispatchId),
    );
  }

  /**
   * Advance the cursor after consuming a batch.
   * Only the winning worker (after guarded Postgres transition) should call this.
   */
  async advanceCursor(params: {
    dispatchId: string;
    newIndex: number;
    newBatch: number;
    status: DispatchStatus;
    ttlSeconds?: number;
  }): Promise<void> {
    const state: Partial<DispatchBatchState> = {
      current_index: String(params.newIndex),
      current_batch: String(params.newBatch),
      status: params.status,
    };

    await this.cacheService.hset(
      this.hashKey(params.dispatchId),
      state,
      params.ttlSeconds ?? this.DEFAULT_TTL_SECONDS,
    );
  }

  /**
   * Update the status field only (e.g., after assignment or failure).
   */
  async updateStatus(
    dispatchId: string,
    status: DispatchStatus,
  ): Promise<void> {
    const existing = await this.read(dispatchId);
    if (!existing) return; // hash expired, no need to update

    await this.cacheService.hset(
      this.hashKey(dispatchId),
      { ...existing, status },
      this.DEFAULT_TTL_SECONDS,
    );
  }

  /**
   * Delete the hash (e.g., on dispatch completion/failure cleanup).
   */
  async delete(dispatchId: string): Promise<void> {
    await this.cacheService.del(this.hashKey(dispatchId));
  }
}
