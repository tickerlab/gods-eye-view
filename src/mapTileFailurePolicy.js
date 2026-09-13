/**
 * Imagery tile-failure policy.
 *
 * A provider can construct successfully and still fail every tile request —
 * offline, a proxy or DNS block, or a content blocker sitting on the tile host.
 * Cesium reports those per tile and keeps retrying, so the globe renders as a
 * featureless sphere while the HUD looks perfectly healthy. This policy turns a
 * run of those failures into one of two truthful outcomes:
 *
 * - `fallback` — the active provider has a keyless alternative left (Esri -> OSM).
 * - `report` — the active provider IS the last fallback, so there is nothing to
 *   switch to and the only honest move is to say the tiles are unreachable.
 *
 * Kept free of Cesium so the escalation rules are unit-testable on their own.
 */

/** Consecutive Esri failures before handing the session to OSM. */
export const ESRI_TILE_FAILURE_THRESHOLD = 2;

/** Consecutive failures on the last fallback before reporting unreachable tiles. */
export const TERMINAL_TILE_FAILURE_THRESHOLD = 3;

/** Stack ids with no keyless provider left behind them. */
export const TERMINAL_STACK_IDS = Object.freeze(['osm']);

export const ESRI_TILE_FAILURE_MESSAGE = 'Esri Satellite tile requests failed; using OSM';

export const TILES_UNREACHABLE_MESSAGE =
  'Map tiles unreachable — check network, proxy, DNS or a content blocker (tile.openstreetmap.org)';

/** No-op decision shared by every ignored failure. */
const NO_DECISION = Object.freeze({ action: 'none', message: null });

/**
 * Folds one Cesium imagery error into a running failure count.
 *
 * Cesium re-reports the same tile as it retries, carrying `timesRetried`. Taking
 * the max of "one more" and "retries + 1" counts a stubborn single tile and a
 * spray of distinct tiles alike, without double-counting either.
 * @param {number} failures Count so far.
 * @param {*} [error] Cesium imagery error, possibly carrying `timesRetried`.
 * @returns {number} Updated count.
 */
export function foldTileFailure(failures, error) {
  const retryCount = Number(error?.timesRetried);
  return Number.isInteger(retryCount) && retryCount >= 0
    ? Math.max(failures + 1, retryCount + 1)
    : failures + 1;
}

/**
 * Whether a stack is the last keyless provider — nothing to fall back to.
 * @param {string} effectiveStackId Stack actually supplying tiles.
 * @returns {boolean}
 */
export function isTerminalStack(effectiveStackId) {
  return TERMINAL_STACK_IDS.includes(effectiveStackId);
}

/**
 * Creates the per-switch escalation state for one imagery provider.
 *
 * A fresh policy belongs to a fresh provider: counts and the report latch never
 * survive a stack switch, so a recovered provider starts clean and a broken one
 * reports exactly once instead of toasting on every retried tile.
 * @param {string} effectiveStackId Stack actually supplying tiles.
 * @returns {{ record: (error?: *) => { action: 'none'|'fallback'|'report', message: string|null } }}
 */
export function createTileFailurePolicy(effectiveStackId) {
  let failures = 0;
  let reported = false;
  const terminal = isTerminalStack(effectiveStackId);
  const threshold = terminal ? TERMINAL_TILE_FAILURE_THRESHOLD : ESRI_TILE_FAILURE_THRESHOLD;

  return {
    record(error) {
      failures = foldTileFailure(failures, error);
      if (failures < threshold || reported) return NO_DECISION;
      if (terminal) {
        reported = true;
        return { action: 'report', message: TILES_UNREACHABLE_MESSAGE };
      }
      if (effectiveStackId !== 'esri-imagery') return NO_DECISION;
      reported = true;
      return { action: 'fallback', message: ESRI_TILE_FAILURE_MESSAGE };
    },
  };
}
