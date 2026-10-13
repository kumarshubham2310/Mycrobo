import assert from 'node:assert/strict';
import test from 'node:test';

import { autonomyReadiness, autonomySummary } from './autonomy-presentation.mjs';

test('automatic delivery readiness exposes every independent execution gate', () => {
  const readiness = autonomyReadiness({ runtime: {
    requested: true,
    releaseCertified: true,
    identityBound: false,
    durableLifecycle: true,
    deliveryBoundaryConfigured: false,
    safetyAuthoritiesConfigured: true,
  } });
  assert.equal(readiness.length, 6);
  assert.deepEqual(readiness.filter((item) => !item.ready).map((item) => item.key), [
    'identityBound', 'deliveryBoundaryConfigured',
  ]);
  assert.equal(autonomySummary({ runtime: Object.fromEntries(readiness.map((item) => [item.key, item.ready])) }).title, 'Automatic delivery is off.');
});

test('automatic delivery summary never treats saved policy as execution authority', () => {
  const summary = autonomySummary({
    tenantDefault: { mode: 'safe' },
    executionConsent: { authorized: true },
    runtime: {},
    automaticSendAvailable: false,
  });
  assert.equal(summary.title, 'Automatic delivery is off.');
  assert.match(summary.detail, /cannot bypass/u);
});

test('available summary keeps fresh per-message checks explicit', () => {
  const summary = autonomySummary({ automaticSendAvailable: true });
  assert.match(summary.title, /available/u);
  assert.match(summary.detail, /exact chat/u);
  assert.match(summary.detail, /latest message/u);
});
