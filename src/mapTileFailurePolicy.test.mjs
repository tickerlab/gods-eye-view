import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ESRI_TILE_FAILURE_MESSAGE,
  ESRI_TILE_FAILURE_THRESHOLD,
  TERMINAL_TILE_FAILURE_THRESHOLD,
  TILES_UNREACHABLE_MESSAGE,
  createTileFailurePolicy,
  foldTileFailure,
  isTerminalStack,
} from './mapTileFailurePolicy.js';

// ── Counting ────────────────────────────────────────────────────────────────

test('distinct tile errors count one apiece', () => {
  assert.equal(foldTileFailure(0, {}), 1);
  assert.equal(foldTileFailure(1, {}), 2);
});

test('one retried tile counts its retries, never less than one more', () => {
  assert.equal(foldTileFailure(0, { timesRetried: 2 }), 3);
  // A stale retry count must not rewind a count driven by other tiles.
  assert.equal(foldTileFailure(5, { timesRetried: 1 }), 6);
});

test('a malformed retry count degrades to plain counting', () => {
  assert.equal(foldTileFailure(0, { timesRetried: -1 }), 1);
  assert.equal(foldTileFailure(0, { timesRetried: 'many' }), 1);
  assert.equal(foldTileFailure(0, undefined), 1);
});

// ── Escalation ──────────────────────────────────────────────────────────────

test('one Esri failure is left to Cesium retry; the second hands over to OSM', () => {
  const policy = createTileFailurePolicy('esri-imagery');
  assert.equal(policy.record({}).action, 'none');
  const decision = policy.record({});
  assert.equal(decision.action, 'fallback');
  assert.equal(decision.message, ESRI_TILE_FAILURE_MESSAGE);
  assert.equal(ESRI_TILE_FAILURE_THRESHOLD, 2);
});

test('Esri hands over exactly once, however long the failures keep coming', () => {
  const policy = createTileFailurePolicy('esri-imagery');
  policy.record({});
  assert.equal(policy.record({}).action, 'fallback');
  for (let i = 0; i < 20; i += 1) {
    assert.equal(policy.record({}).action, 'none');
  }
});

test('OSM is terminal: a run of failures reports unreachable tiles instead of switching', () => {
  const policy = createTileFailurePolicy('osm');
  for (let i = 1; i < TERMINAL_TILE_FAILURE_THRESHOLD; i += 1) {
    assert.equal(policy.record({}).action, 'none');
  }
  const decision = policy.record({});
  assert.equal(decision.action, 'report');
  assert.equal(decision.message, TILES_UNREACHABLE_MESSAGE);
});

test('the unreachable report latches — a blocked host must not toast per tile', () => {
  const policy = createTileFailurePolicy('osm');
  let reports = 0;
  for (let i = 0; i < 50; i += 1) {
    if (policy.record({}).action === 'report') reports += 1;
  }
  assert.equal(reports, 1);
});

test('a fresh switch starts clean — recovery is never poisoned by the old provider', () => {
  const broken = createTileFailurePolicy('osm');
  for (let i = 0; i < 10; i += 1) broken.record({});
  const recovered = createTileFailurePolicy('osm');
  assert.equal(recovered.record({}).action, 'none');
});

test('stacks that are not the last fallback never report unreachable tiles', () => {
  assert.equal(isTerminalStack('osm'), true);
  assert.equal(isTerminalStack('esri-imagery'), false);
  assert.equal(isTerminalStack('photoreal'), false);
  const policy = createTileFailurePolicy('photoreal');
  for (let i = 0; i < 10; i += 1) {
    assert.equal(policy.record({}).action, 'none');
  }
});
