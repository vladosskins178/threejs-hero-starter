import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameLimiter, createGovernor, pickQuality } from '../src/quality.js';

const desktop = { devicePixelRatio: 2, viewportWidth: 1440, cores: 8, memoryGb: 8 };

test('desktop gets the high tier with pixel ratio capped at 2', () => {
  assert.deepEqual(pickQuality({ ...desktop, devicePixelRatio: 3 }), {
    tier: 'high',
    pixelRatio: 2,
    maxPixelRatio: 2,
    antialias: false,
    maxFps: 60,
  });
  assert.equal(pickQuality({ ...desktop, devicePixelRatio: 1 }).antialias, true);
});

test('phones are capped at 1.5x', () => {
  const q = pickQuality({ devicePixelRatio: 3, viewportWidth: 390, cores: 8, coarsePointer: true });
  assert.equal(q.tier, 'medium');
  assert.equal(q.pixelRatio, 1.5);
  assert.equal(q.antialias, true);
});

test('low-end devices run at 1x and 30 fps', () => {
  for (const env of [{ ...desktop, cores: 4 }, { ...desktop, memoryGb: 2 }]) {
    const q = pickQuality(env);
    assert.equal(q.tier, 'low');
    assert.equal(q.pixelRatio, 1);
    assert.equal(q.maxFps, 30);
  }
});

test('Save-Data turns 3D off', () => {
  assert.equal(pickQuality({ ...desktop, saveData: true }).tier, 'off');
});

test('missing signals do not count as low-end', () => {
  assert.equal(pickQuality({ devicePixelRatio: 1, viewportWidth: 1200 }).tier, 'high');
});

const feed = (gov, ms, n) => {
  let last = null;
  for (let i = 0; i < n; i++) {
    const r = gov.sample(ms);
    if (r !== null) last = r;
  }
  return last;
};

test('governor steps resolution down when frames are slow', () => {
  const gov = createGovernor({ pixelRatio: 2, targetFps: 60, window: 10 });
  assert.equal(feed(gov, 30, 10), 1.75);
  assert.equal(feed(gov, 30, 10), 1.5);
  assert.equal(gov.pixelRatio, 1.5);
});

test('governor never goes below the floor', () => {
  const gov = createGovernor({ pixelRatio: 1, minPixelRatio: 0.75, window: 5 });
  feed(gov, 100, 50);
  assert.equal(gov.pixelRatio, 0.75);
});

test('governor climbs back slowly and only up to the cap', () => {
  const gov = createGovernor({ pixelRatio: 1.5, maxPixelRatio: 1.5, window: 5 });
  feed(gov, 40, 5); // down to 1.25
  assert.equal(gov.pixelRatio, 1.25);
  assert.equal(feed(gov, 8, 10), null, 'two fast windows are not enough');
  assert.equal(feed(gov, 8, 5), 1.5);
  feed(gov, 8, 50);
  assert.equal(gov.pixelRatio, 1.5);
});

test('governor ignores bogus samples such as tab switches', () => {
  const gov = createGovernor({ pixelRatio: 2, window: 3 });
  assert.equal(feed(gov, 5000, 10), null);
  assert.equal(feed(gov, 0, 10), null);
  assert.equal(gov.pixelRatio, 2);
});

test('frame limiter keeps roughly the requested rate on a 60 Hz display', () => {
  const limit = createFrameLimiter(30);
  let drawn = 0;
  for (let i = 0; i < 60; i++) if (limit(i * (1000 / 60))) drawn++;
  assert.equal(drawn, 30);
  const unlimited = createFrameLimiter(60);
  let all = 0;
  for (let i = 0; i < 60; i++) if (unlimited(i * (1000 / 60))) all++;
  assert.equal(all, 60);
});
