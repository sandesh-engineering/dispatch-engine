import { CacheService } from '@platform/cache';
import { SEARCH_LEVELS } from '../constants/search-level.constant';
import {
  AgentSession,
  Coordinates,
  EligibleAgent,
  NearbyAgent,
} from '../types/candidate-discovery.type';
import { CandidateDiscoveryStrategy } from '../interfaces/candidate-discovery.interface';
import { AgentAvailabilityStatus } from 'src/modules/ETA';

/**
 * Performs bounded search where we stop whenever our stopping condition is fulfilled
 */
export class ProgressiveCandidateDiscovery
  implements CandidateDiscoveryStrategy
{
  constructor(
    private readonly cacheService: CacheService,
    private readonly maxCandidatePool: number,
  ) {}

  /**
   * Discover eligible delivery agents using progressively larger search
   * boundaries until the required candidate pool is reached.
   *
   * @remarks
   * - Searches each configured radius sequentially.
   * - Previously discovered agents are not processed again.
   * - Session lookups for each search level are executed through one Redis pipeline.
   * - The search stops early once the required eligible-agent pool is reached.
   * - The final result contains only the nearest eligible agents up to the pool limit.
   *
   * @param {Coordinates} restaurantCoords - Restaurant coordinates used as the search origin.
   * @returns {Promise<EligibleAgent[]>} The nearest eligible delivery agents.
   *
   * @example
   * ```ts
   * const agents = await discovery.discover({
   *   longitude: 85.324,
   *   latitude: 27.717,
   * });
   * ```
   */
  async discover(restaurantCoords: Coordinates): Promise<EligibleAgent[]> {
    const discoveredAgents = new Set<string>();
    const eligibleAgents = new Map<string, EligibleAgent>();

    for (const level of SEARCH_LEVELS) {
      const nearbyAgents = await this.searchNearbyAgents(
        restaurantCoords,
        level.radiusKm,
        level.maxCandidates,
      );

      const newAgents = this.collectNewAgents(nearbyAgents, discoveredAgents);

      if (newAgents.length === 0) {
        continue;
      }

      const agentsWithSessions = await this.loadAgentSessions(newAgents);

      const eligible = this.filterEligibleAgents(agentsWithSessions);

      for (const agent of eligible) {
        eligibleAgents.set(agent.member, agent);
      }

      if (eligibleAgents.size >= this.maxCandidatePool) {
        break;
      }
    }

    return this.selectNearestAgents([...eligibleAgents.values()]);
  }

  /**
   * Search for nearby delivery agents within a specific radius.
   *
   * @remarks
   * - Results are sorted by geographic distance in ascending order.
   * - The result count is bounded by the configured candidate limit.
   *
   * @param {Coordinates} restaurantCoords - Restaurant coordinates used as the search origin.
   * @param {number} radiusKm - Maximum search radius in kilometres.
   * @param {number} maxCandidates - Maximum number of agents to return.
   * @returns {Promise<NearbyAgent[]>} Nearby delivery agents ordered by distance.
   *
   * @example
   * ```ts
   * const agents = await this.searchNearbyAgents(
   *   restaurantCoords,
   *   2,
   *   30,
   * );
   * ```
   */
  private async searchNearbyAgents(
    restaurantCoords: Coordinates,
    radiusKm: number,
    maxCandidates: number,
  ): Promise<NearbyAgent[]> {
    return this.cacheService.geoSearch(
      'location:delivery-agents',
      {
        longitude: restaurantCoords.longitude,
        latitude: restaurantCoords.latitude,
      },
      radiusKm,
      'km',
      {
        withDist: true,
        withCoord: true,
        count: maxCandidates,
        sort: 'ASC',
      },
    );
  }

  /**
   * Collect agents that have not been discovered by a previous search level.
   *
   * @remarks
   * - Uses the delivery-agent member as the unique identifier.
   * - Previously discovered agents are skipped.
   * - Newly discovered agent IDs are added to the set.
   *
   * @param {NearbyAgent[]} nearbyAgents - Agents returned by the current geo search.
   * @param {Set<string>} discoveredAgents - IDs of agents already discovered.
   * @returns {NearbyAgent[]} Agents discovered for the first time at the current search level.
   *
   * @example
   * ```ts
   * const newAgents = this.collectNewAgents(
   *   nearbyAgents,
   *   discoveredAgents,
   * );
   * ```
   */
  private collectNewAgents(
    nearbyAgents: NearbyAgent[],
    discoveredAgents: Set<string>,
  ): NearbyAgent[] {
    const newAgents: NearbyAgent[] = [];

    for (const agent of nearbyAgents) {
      if (discoveredAgents.has(agent.member)) {
        continue;
      }

      discoveredAgents.add(agent.member);
      newAgents.push(agent);
    }

    return newAgents;
  }

  /**
   * Load delivery-agent session data using a Redis pipeline.
   *
   * @remarks
   * - Queues one session lookup per newly discovered agent.
   * - All session lookups for the current search level are executed together.
   * - Previously processed agents are never queried again.
   *
   * @param {NearbyAgent[]} agents - Delivery agents whose session data should be loaded.
   * @returns {Promise<Array<NearbyAgent & { session: AgentSession | null }>>} Agents with their session data.
   *
   * @example
   * ```ts
   * const agentsWithSessions =
   *   await this.loadAgentSessions(newAgents);
   * ```
   */
  private async loadAgentSessions(agents: NearbyAgent[]): Promise<
    Array<
      NearbyAgent & {
        session: AgentSession | null;
      }
    >
  > {
    const pipeline = this.cacheService.pipeline();

    for (const agent of agents) {
      pipeline.hgetall(`delivery-agent:${agent.member}`);
    }

    const results = await pipeline.exec();

    if (!results) {
      return agents.map((agent) => ({
        ...agent,
        session: null,
      }));
    }

    return agents.map((agent, index) => ({
      ...agent,
      session: this.extractPipelineResult(results[index]),
    }));
  }

  /**
   * Extract an agent session from a Redis pipeline result.
   *
   * @remarks
   * - Converts Redis command failures into a missing session.
   * - Converts empty Redis values into a missing session.
   * - Keeps Redis-specific result handling isolated from eligibility filtering.
   *
   * @param {[Error | null, unknown]} result - Result returned by a Redis pipeline command.
   * @returns {AgentSession | null} Parsed agent session or null when unavailable.
   *
   * @example
   * ```ts
   * const session =
   *   this.extractPipelineResult(result);
   * ```
   */
  private extractPipelineResult(
    result: [Error | null, any] | undefined,
  ): AgentSession | null {
    if (!result) {
      return null;
    }

    const [error, value] = result;

    if (error || !value) {
      return null;
    }

    return value as AgentSession;
  }

  /**
   * Filter delivery agents based on their current session state.
   *
   * @remarks
   * - An agent must have an active session.
   * - An agent must be connected.
   * - An agent must have AVAILABLE delivery-agent availability.
   *
   * @param {Array<NearbyAgent & { session: AgentSession | null }>} agents - Agents with loaded session data.
   * @returns {EligibleAgent[]} Agents currently eligible for dispatch.
   *
   * @example
   * ```ts
   * const eligible =
   *   this.filterEligibleAgents(
   *     agentsWithSessions,
   *   );
   * ```
   */
  private filterEligibleAgents(
    agents: Array<
      NearbyAgent & {
        session: AgentSession | null;
      }
    >,
  ): EligibleAgent[] {
    return agents.filter(
      (agent): agent is EligibleAgent =>
        agent.session !== null &&
        agent.session.connected &&
        agent.session.availability === AgentAvailabilityStatus.AVAILABLE,
    );
  }

  /**
   * Select the nearest eligible delivery agents.
   *
   * @remarks
   * - Sorts candidates by geographic distance.
   * - Limits the result to the configured candidate pool.
   * - A full sort is sufficient because the candidate pool is intentionally bounded.
   *
   * @param {EligibleAgent[]} agents - Eligible delivery-agent candidates.
   * @returns {EligibleAgent[]} The nearest eligible delivery agents.
   *
   * @example
   * ```ts
   * const candidates =
   *   this.selectNearestAgents(eligibleAgents);
   * ```
   */
  private selectNearestAgents(agents: EligibleAgent[]): EligibleAgent[] {
    return agents
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.maxCandidatePool);
  }
}
