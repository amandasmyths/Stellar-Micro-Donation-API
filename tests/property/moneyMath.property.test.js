'use strict';

/**
 * Property-based tests for money / fee / conversion math (issue #1165).
 *
 * Rounding and precision bugs hide in inputs nobody hand-picks — odd stroop
 * values, rates that round at the boundary, very large or very small amounts.
 * Each test below encodes an invariant that must hold for ALL valid inputs and
 * checks it across a generated spread (including boundaries), so a regression
 * in the precision-sensitive helpers fails CI automatically.
 */

const {
  forAll,
  floatInRange,
  intInRange,
  xlmAmountString,
} = require('../helpers/propertyTest');

const {
  calculateAnalyticsFee,
  MIN_FEE,
  MAX_FEE_PERCENTAGE,
} = require('../../src/utils/feeCalculator');

const {
  roundHalfEven,
  convertToXLMWithMeta,
  STROOPS_PER_XLM,
} = require('../../src/utils/currencyConversion');

const { validateXLMAmount } = require('../../src/utils/validationHelpers');

// Documented conversion tolerance: one stroop in XLM terms.
const ONE_STROOP_XLM = 1 / STROOPS_PER_XLM;

describe('feeCalculator.calculateAnalyticsFee — invariants', () => {
  // Generate {amount, feePercentage} across the realistic range.
  const genAmountAndPct = (rng) => ({
    amount: floatInRange(MIN_FEE, 100_000, 2)(rng),
    feePercentage: floatInRange(0, MAX_FEE_PERCENTAGE, 4)(rng),
  });

  test('fee is always ≥ 0', () => {
    forAll(genAmountAndPct, ({ amount, feePercentage }) => {
      const { fee } = calculateAnalyticsFee(amount, feePercentage);
      expect(fee).toBeGreaterThanOrEqual(0);
    });
  });

  test('fee is always ≥ the configured minimum fee', () => {
    forAll(genAmountAndPct, ({ amount, feePercentage }) => {
      const { fee } = calculateAnalyticsFee(amount, feePercentage);
      // The implementation floors every fee at MIN_FEE.
      expect(fee).toBeGreaterThanOrEqual(MIN_FEE - 1e-9);
    });
  });

  test('fee never exceeds the donation amount (for amounts ≥ MIN_FEE)', () => {
    // Below MIN_FEE the flat-minimum fee legitimately exceeds the donation;
    // for any donation at or above the minimum the fee must not exceed it.
    forAll(genAmountAndPct, ({ amount, feePercentage }) => {
      const { fee } = calculateAnalyticsFee(amount, feePercentage);
      expect(fee).toBeLessThanOrEqual(amount + 1e-9);
    });
  });

  test('totalWithFee equals amount + fee (to cent precision)', () => {
    forAll(genAmountAndPct, ({ amount, feePercentage }) => {
      const { fee, totalWithFee, originalAmount } = calculateAnalyticsFee(amount, feePercentage);
      expect(originalAmount).toBe(amount);
      expect(totalWithFee).toBeCloseTo(amount + fee, 2);
    });
  });

  test('a higher fee percentage never produces a smaller fee (monotonic)', () => {
    forAll(
      (rng) => floatInRange(MIN_FEE, 100_000, 2)(rng),
      (amount) => {
        const low = calculateAnalyticsFee(amount, 0.01).fee;
        const high = calculateAnalyticsFee(amount, MAX_FEE_PERCENTAGE).fee;
        expect(high).toBeGreaterThanOrEqual(low - 1e-9);
      }
    );
  });

  test('rejects non-positive amounts and out-of-range percentages', () => {
    expect(() => calculateAnalyticsFee(0)).toThrow();
    expect(() => calculateAnalyticsFee(-5)).toThrow();
    expect(() => calculateAnalyticsFee(10, MAX_FEE_PERCENTAGE + 0.01)).toThrow();
    expect(() => calculateAnalyticsFee(10, -0.01)).toThrow();
  });
});

describe('currencyConversion.roundHalfEven — invariants', () => {
  test('result is always rounded to ≤ 7 decimal places', () => {
    forAll(floatInRange(-1_000_000, 1_000_000, 9), (value) => {
      const rounded = roundHalfEven(value, 7);
      // Re-rounding to 7dp must be a fixed point.
      expect(roundHalfEven(rounded, 7)).toBeCloseTo(rounded, 10);
      const decimals = (rounded.toString().split('.')[1] || '').length;
      expect(decimals).toBeLessThanOrEqual(7);
    });
  });

  test('rounding error is at most half a stroop', () => {
    forAll(floatInRange(-1_000, 1_000, 9), (value) => {
      const rounded = roundHalfEven(value, 7);
      expect(Math.abs(rounded - value)).toBeLessThanOrEqual(ONE_STROOP_XLM / 2 + 1e-12);
    });
  });

  test('rounding an already-7dp value is the identity', () => {
    forAll(floatInRange(-10_000, 10_000, 7), (value) => {
      expect(roundHalfEven(value, 7)).toBeCloseTo(value, 10);
    });
  });
});

describe('currencyConversion.convertToXLMWithMeta — invariants', () => {
  const genConversion = (rng) => ({
    sourceAmount: floatInRange(0, 100_000, 2)(rng),
    rate: floatInRange(0.0001, 1000, 6)(rng),
  });

  test('converted XLM is non-negative and reproducible from stored inputs', () => {
    forAll(genConversion, ({ sourceAmount, rate }) => {
      const meta = convertToXLMWithMeta(sourceAmount, 'USD', rate);
      expect(meta.xlm).toBeGreaterThanOrEqual(0);
      // Reproducibility guarantee documented in the module.
      expect(meta.xlm).toBeCloseTo(roundHalfEven(sourceAmount * rate, 7), 10);
    });
  });

  test('stroops is an integer equal to round(xlm * STROOPS_PER_XLM)', () => {
    forAll(genConversion, ({ sourceAmount, rate }) => {
      const meta = convertToXLMWithMeta(sourceAmount, 'USD', rate);
      expect(Number.isInteger(meta.stroops)).toBe(true);
      expect(meta.stroops).toBe(Math.round(meta.xlm * STROOPS_PER_XLM));
    });
  });

  test('converting and converting back round-trips within one stroop', () => {
    forAll(genConversion, ({ sourceAmount, rate }) => {
      const { xlm } = convertToXLMWithMeta(sourceAmount, 'USD', rate);
      const backToSource = xlm / rate;
      // Tolerance scales with the rate: rounding to a stroop in XLM is at most
      // one stroop / rate in source-currency terms.
      const tolerance = ONE_STROOP_XLM / rate + 1e-9;
      expect(Math.abs(backToSource - sourceAmount)).toBeLessThanOrEqual(tolerance);
    });
  });

  test('rejects negative amounts and non-positive rates', () => {
    expect(() => convertToXLMWithMeta(-1, 'USD', 10)).toThrow();
    expect(() => convertToXLMWithMeta(10, 'USD', 0)).toThrow();
    expect(() => convertToXLMWithMeta(10, 'USD', -5)).toThrow();
  });
});

describe('stroop arithmetic — round-trip, associativity, commutativity', () => {
  const toStroops = (xlmStr) => {
    const res = validateXLMAmount(xlmStr, { allowZero: true });
    if (!res.valid) throw new Error(`generator produced invalid amount: ${xlmStr} (${res.error})`);
    return res.stroops;
  };
  const fromStroops = (stroops) => stroops / STROOPS_PER_XLM;

  test('fromStroops(toStroops(x)) === x for all valid display amounts', () => {
    forAll(xlmAmountString(0.0000001, 1_000_000), (xlmStr) => {
      const round = fromStroops(toStroops(xlmStr));
      expect(round).toBeCloseTo(parseFloat(xlmStr), 7);
    });
  });

  test('summation in stroops is commutative (order-independent)', () => {
    const genTriple = (rng) => [
      xlmAmountString(0, 10_000)(rng),
      xlmAmountString(0, 10_000)(rng),
      xlmAmountString(0, 10_000)(rng),
    ];
    forAll(genTriple, ([a, b, c]) => {
      const sa = toStroops(a), sb = toStroops(b), sc = toStroops(c);
      expect(sa + sb + sc).toBe(sc + sb + sa);
    });
  });

  test('summation in stroops is associative', () => {
    const genTriple = (rng) => [
      xlmAmountString(0, 10_000)(rng),
      xlmAmountString(0, 10_000)(rng),
      xlmAmountString(0, 10_000)(rng),
    ];
    forAll(genTriple, ([a, b, c]) => {
      const sa = toStroops(a), sb = toStroops(b), sc = toStroops(c);
      expect((sa + sb) + sc).toBe(sa + (sb + sc));
    });
  });

  test('stroop totals are exact integers regardless of summation order', () => {
    const genList = (rng) => {
      const n = intInRange(2, 25)(rng);
      return Array.from({ length: n }, () => xlmAmountString(0, 1_000)(rng));
    };
    forAll(genList, (amounts) => {
      const stroops = amounts.map(toStroops);
      const forward = stroops.reduce((acc, s) => acc + s, 0);
      const reverse = [...stroops].reverse().reduce((acc, s) => acc + s, 0);
      expect(Number.isInteger(forward)).toBe(true);
      expect(forward).toBe(reverse);
    });
  });
});
