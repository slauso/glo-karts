/**
 * grand-prix-service.js — Multi-race cup progression for Grand Prix mode.
 *
 * Wraps the existing grand-prix module into the DI service interface.
 */

import {
  startGrandPrix, reportRaceResult, hasNextRace, advanceToNextRace,
  getStandings, getCurrentRaceInfo, isGrandPrixActive, endGrandPrix,
  showStandingsOverlay, showFinalResultsOverlay, restoreGrandPrixState,
} from '../../../grand-prix.js';
import { SINGLE_PLAYER_CUPS } from '../../../content-registry.js';

export class GrandPrixService {
  constructor(deps) {
    this.gameConfig = deps?.gameConfig || {};
    this._running = false;
  }

  start(competitorNames = ['You'], onTrackChange = null) {
    const cupId = this.gameConfig.cupId || 'starter';
    const cup = SINGLE_PLAYER_CUPS[cupId];
    if (!cup) return;

    startGrandPrix(cupId, competitorNames, onTrackChange);

    // Restore standings if resuming mid-cup
    const raceIdx = this.gameConfig._gpRaceIdx || 0;
    if (raceIdx > 0 && this.gameConfig._gpStandings) {
      restoreGrandPrixState(raceIdx, this.gameConfig._gpStandings);
    }

    this._running = true;
  }

  reportRaceResult(result) {
    if (!this._running) return;
    reportRaceResult(result);
  }

  hasNextRace() {
    return this._running && hasNextRace();
  }

  advanceToNextRace() {
    return advanceToNextRace();
  }

  getStandings() {
    return getStandings();
  }

  getCurrentRaceInfo() {
    return getCurrentRaceInfo();
  }

  isActive() {
    return this._running && isGrandPrixActive();
  }

  showStandings() {
    showStandingsOverlay();
  }

  showFinalResults() {
    showFinalResultsOverlay();
  }

  end() {
    if (this._running) {
      endGrandPrix();
      this._running = false;
    }
  }

  dispose() {
    this.end();
  }
}
