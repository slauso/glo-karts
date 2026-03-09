import { NormalRaceMode } from './normal-race-mode.js';
import { QuickRaceMode } from './quick-race-mode.js';
import { TimeTrialMode } from './time-trial-mode.js';
import { GrandPrixMode } from './grand-prix-mode.js';
import { FreeRoamMode } from './free-roam-mode.js';
import { FollowTheLeaderMode } from './follow-the-leader-mode.js';
import { SoccerMode } from './soccer-mode.js';
import { BattleMode } from './battle-mode.js';
import { LocalSplitScreenMode } from './local-splitscreen-mode.js';

/**
 * Builds rebuilt mode instances from mode IDs.
 * @param {string} modeId
 * @param {object} deps
 */
export function createRebuildMode(modeId, deps = {}) {
  switch (modeId) {
    case 'normal_race': return new NormalRaceMode(deps);
    case 'quick_race': return new QuickRaceMode(deps);
    case 'time_trial': return new TimeTrialMode(deps);
    case 'grand_prix': return new GrandPrixMode(deps);
    case 'free_roam': return new FreeRoamMode(deps);
    case 'follow_the_leader': return new FollowTheLeaderMode(deps);
    case 'soccer': return new SoccerMode(deps);
    case 'battle_solo': return new BattleMode(deps, 'deathmatch');
    case 'three_strikes': return new BattleMode(deps, 'three_strikes');
    case 'ctf': return new BattleMode(deps, 'ctf');
    case 'local_2p_race':
    case 'local_2p_battle': return new LocalSplitScreenMode(deps);
    default: return new QuickRaceMode(deps);
  }
}
