/**
 * @section imports:internals
 */

import type { MarketKey } from "../market/market.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { OpportunityFactorBoard, OpportunityLiveState } from "./opportunity.types.ts";

/**
 * @section class
 */

export class OpportunityStoreService {
  /**
   * @section private:attributes
   */

  private readonly liveStates: Map<MarketKey, OpportunityLiveState | null>;

  /**
   * @section constructor
   */

  public constructor() {
    this.liveStates = this.createInitialStates();
  }

  /**
   * @section private:methods
   */

  private createInitialStates(): Map<MarketKey, OpportunityLiveState | null> {
    const liveStates = new Map<MarketKey, OpportunityLiveState | null>();
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        liveStates.set(`${asset}:${window}`, null);
      }
    }
    return liveStates;
  }

  private requireLiveState(marketKey: MarketKey): OpportunityLiveState | null {
    if (!this.liveStates.has(marketKey)) {
      throw new Error(`Missing opportunity live state for ${marketKey}`);
    }
    return this.liveStates.get(marketKey) ?? null;
  }

  /**
   * @section public:methods
   */

  public setLiveState(marketKey: MarketKey, liveState: OpportunityLiveState | null): void {
    if (!this.liveStates.has(marketKey)) {
      throw new Error(`Missing opportunity live state bucket for ${marketKey}`);
    }
    this.liveStates.set(marketKey, liveState);
  }

  public getLiveState(marketKey: MarketKey): OpportunityLiveState | null {
    const liveState = this.requireLiveState(marketKey);
    return liveState;
  }

  public getMarketSummaries(): OpportunityLiveState["market"][] {
    const marketSummaries = [...this.liveStates.values()].filter((liveState) => liveState !== null).map((liveState) => liveState.market);
    return marketSummaries;
  }

  public getFactorBoards(): OpportunityFactorBoard[] {
    const factorBoards = [...this.liveStates.values()].filter((liveState) => liveState !== null).map((liveState) => liveState.factorBoard);
    return factorBoards;
  }
}
