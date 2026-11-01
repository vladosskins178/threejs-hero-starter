// Pure helpers that decide how hard the hero is allowed to work.
// No DOM or three.js imports here, so they run (and are tested) in Node.

/**
 * Pick a starting quality tier from what the browser tells us about the device.
 * @param {object} env
 * @param {number} env.devicePixelRatio
 * @param {number} env.viewportWidth   CSS pixels
 * @param {number} [env.cores]         navigator.hardwareConcurrency
 * @param {number} [env.memoryGb]      navigator.deviceMemory (Chromium only)
 * @param {boolean} [env.coarsePointer] matchMedia('(pointer: coarse)')
 * @param {boolean} [env.saveData]     navigator.connection.saveData
 */
export function pickQuality(env) {
  const dpr = Math.max(1, env.devicePixelRatio || 1);
  const mobile = Boolean(env.coarsePointer) || env.viewportWidth < 768;
  const lowEnd =
    (env.cores !== undefined && env.cores <= 4) || (env.memoryGb !== undefined && env.memoryGb <= 4);

  if (env.saveData) {
    return { tier: 'off', pixelRatio: 0, maxPixelRatio: 0, antialias: false, maxFps: 0 };
  }
  if (lowEnd) {
    return { tier: 'low', pixelRatio: 1, maxPixelRatio: 1, antialias: false, maxFps: 30 };
  }
  const cap = mobile ? 1.5 : 2;
  const pixelRatio = Math.min(dpr, cap);
  return {
    tier: mobile ? 'medium' : 'high',
    pixelRatio,
    maxPixelRatio: pixelRatio,
    // At 2x the extra pixels already smooth edges, so MSAA is skipped there.
    antialias: pixelRatio < 2,
    maxFps: 60,
  };
}

/**
 * Watches frame times and lowers (or carefully raises) the pixel ratio so the
 * hero stays smooth instead of heating the phone.
 *
 * Call `sample(ms)` once per rendered frame. It returns a new pixel ratio when
 * one should be applied, otherwise null.
 */
export function createGovernor({
  pixelRatio,
  maxPixelRatio = pixelRatio,
  minPixelRatio = 0.75,
  targetFps = 60,
  window: size = 45,
  step = 0.25,
} = {}) {
  const budget = 1000 / targetFps;
  let current = pixelRatio;
  let frames = [];
  let goodStreak = 0;

  return {
    get pixelRatio() {
      return current;
    },
    sample(ms) {
      if (!(ms > 0) || ms > 1000) return null; // ignore tab switches and bogus samples
      frames.push(ms);
      if (frames.length < size) return null;

      const sorted = [...frames].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      frames = [];

      if (median > budget * 1.25 && current > minPixelRatio) {
        goodStreak = 0;
        current = Math.max(minPixelRatio, round(current - step));
        return current;
      }
      if (median < budget * 0.8 && current < maxPixelRatio) {
        // Only step back up after several fast windows in a row, to avoid flapping.
        goodStreak += 1;
        if (goodStreak >= 3) {
          goodStreak = 0;
          current = Math.min(maxPixelRatio, round(current + step));
          return current;
        }
        return null;
      }
      goodStreak = 0;
      return null;
    },
  };
}

/** Frame limiter: returns true when enough time passed to draw the next frame. */
export function createFrameLimiter(maxFps) {
  const interval = maxFps > 0 ? 1000 / maxFps : 0;
  let last = -Infinity;
  return (now) => {
    // 1 ms of slack so 60 fps displays are not throttled to 30 by timer jitter.
    if (now - last < interval - 1) return false;
    last = now;
    return true;
  };
}

const round = (n) => Math.round(n * 100) / 100;
