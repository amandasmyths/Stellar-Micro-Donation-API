'use strict';

/**
 * Minimal property-based testing helper (issue #1165).
 *
 * Example-based unit tests only check the inputs the author thought of.
 * Money/fee/conversion math is precision-sensitive and full of boundary
 * conditions, so we generate a large spread of inputs and assert invariants
 * that must hold for ALL of them.
 *
 * This is a tiny, dependency-free harness (rather than pulling in fast-check)
 * so the property tests stay self-contained and the lockfile is untouched. It
 * provides:
 *   - a deterministic, seeded PRNG so any failure is reproducible,
 *   - generators for the value ranges that matter for Stellar money math,
 *   - `forAll`, which runs a property `runs` times and, on the first failing
 *     input, throws an error embedding the counterexample.
 */

/** Deterministic PRNG (mulberry32) — same seed ⇒ same sequence. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run `property` for each value produced by `generator`. On the first failure
 * the thrown error names the seed and the offending value so the case can be
 * reproduced and frozen as a regression test.
 *
 * @param {(rng: () => number) => any} generator - produces one input value
 * @param {(value: any) => void} property - asserts the invariant; throws on violation
 * @param {Object} [opts]
 * @param {number} [opts.runs=500]
 * @param {number} [opts.seed=0xC0FFEE]
 */
function forAll(generator, property, opts = {}) {
  const { runs = 500, seed = 0xc0ffee } = opts;
  const rng = mulberry32(seed);
  for (let i = 0; i < runs; i++) {
    const value = generator(rng);
    try {
      property(value);
    } catch (err) {
      const printable = (() => {
        try { return JSON.stringify(value); } catch { return String(value); }
      })();
      err.message =
        `Property failed on run ${i + 1}/${runs} (seed=${seed}) ` +
        `for input ${printable}:\n${err.message}`;
      throw err;
    }
  }
}

// ── Generators ───────────────────────────────────────────────────────────────

/** Uniform float in [min, max], rounded to `decimals` places. */
function floatInRange(min, max, decimals = 7) {
  return (rng) => {
    const raw = min + rng() * (max - min);
    return parseFloat(raw.toFixed(decimals));
  };
}

/** Uniform integer in [min, max] (inclusive). */
function intInRange(min, max) {
  return (rng) => min + Math.floor(rng() * (max - min + 1));
}

/**
 * A realistic XLM amount as a fixed-point string with up to 7 decimal places,
 * spanning sub-stroop boundaries up to large balances. Never produces
 * scientific notation, matching the input-boundary validator.
 */
function xlmAmountString(min = 0.0000001, max = 1_000_000) {
  const f = floatInRange(min, max, 7);
  return (rng) => {
    const v = f(rng);
    // Guarantee strictly positive after rounding.
    const safe = v <= 0 ? 0.0000001 : v;
    return safe.toFixed(7).replace(/\.?0+$/, '') || '0';
  };
}

/** Pick one element from `choices`. */
function oneOf(choices) {
  return (rng) => choices[Math.floor(rng() * choices.length)];
}

module.exports = {
  mulberry32,
  forAll,
  floatInRange,
  intInRange,
  xlmAmountString,
  oneOf,
};
