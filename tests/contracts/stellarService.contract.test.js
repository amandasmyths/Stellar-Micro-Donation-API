'use strict';

/**
 * Contract / parity tests between MockStellarService and StellarService.
 * Issue #1164.
 *
 * One shared contract (see ./stellarServiceContract.js) is executed against
 * BOTH the mock and the real implementation. On top of that, a direct
 * mock-vs-real parity matrix asserts the two never drift in method surface or
 * signature beyond the explicitly documented divergences. Any undocumented
 * drift — a new interface method left unimplemented, a changed arity, a method
 * that appears on one side but not the other — fails CI.
 */

const StellarServiceInterface = require('../../src/services/interfaces/StellarServiceInterface');
const MockStellarService = require('../../src/services/MockStellarService');
const StellarService = require('../../src/services/StellarService');
const {
  runStellarServiceContract,
  CONTRACT_METHODS,
  KNOWN_DIVERGENCES,
  overridesMethod,
} = require('./stellarServiceContract');

// ── The shared contract, run against each implementation ─────────────────────

runStellarServiceContract({
  name: 'MockStellarService',
  impl: 'mock',
  createService: () => new MockStellarService({ network: 'testnet' }),
  capabilities: { offlineWallets: true },
});

runStellarServiceContract({
  name: 'StellarService (real)',
  impl: 'real',
  createService: () => new StellarService({ network: 'testnet' }),
  capabilities: { offlineWallets: false },
});

// ── Direct mock-vs-real parity matrix ────────────────────────────────────────

describe('MockStellarService ⇄ StellarService parity', () => {
  const mock = new MockStellarService({ network: 'testnet' });
  const real = new StellarService({ network: 'testnet' });

  test('both implementations extend StellarServiceInterface', () => {
    expect(mock).toBeInstanceOf(StellarServiceInterface);
    expect(real).toBeInstanceOf(StellarServiceInterface);
  });

  test('the contract covers every method declared on the interface', () => {
    const ifaceMethods = Object.getOwnPropertyNames(StellarServiceInterface.prototype)
      .filter((n) => n !== 'constructor');
    expect(CONTRACT_METHODS.map((m) => m.name).sort()).toEqual(ifaceMethods.sort());
  });

  describe('per-method signature parity', () => {
    test.each(CONTRACT_METHODS.map((m) => [m.name, m]))(
      '%s() — mock and real agree (within documented divergences)',
      (methodName) => {
        const mockOverrides = overridesMethod(mock, methodName);
        const realOverrides = overridesMethod(real, methodName);
        const divergence = KNOWN_DIVERGENCES[methodName] || {};

        // Both must expose the method as callable (presence via inheritance).
        expect(typeof mock[methodName]).toBe('function');
        expect(typeof real[methodName]).toBe('function');

        // Whether each side OVERRIDES the interface stub is fixed by the
        // documented divergence map; an undocumented inherited-vs-overridden
        // mismatch is real drift and fails here.
        expect(mockOverrides).toBe(divergence.mock !== 'inherited');
        expect(realOverrides).toBe(divergence.real !== 'inherited');

        // When BOTH override, their declared arity must match unless a
        // divergence is documented for that side.
        if (mockOverrides && realOverrides) {
          const mockArity = mock[methodName].length;
          const realArity = real[methodName].length;
          const mockDoc = typeof divergence.mock === 'string' && divergence.mock.startsWith('arity:');
          const realDoc = typeof divergence.real === 'string' && divergence.real.startsWith('arity:');
          if (!mockDoc && !realDoc) {
            expect(mockArity).toBe(realArity);
          }
        }
      }
    );
  });

  test('offline-pure conversions agree between mock and a reference impl', () => {
    // stroops/XLM conversion is part of the contract but only the mock
    // implements it as a class method. Guard that the mock honours the
    // canonical 1 XLM = 10,000,000 stroops relationship the real service's
    // SDK-backed math also obeys.
    expect(mock.xlmToStroops('1')).toBe('10000000');
    expect(mock.stroopsToXlm('10000000')).toBe('1.0000000');
    expect(mock.stroopsToXlm(mock.xlmToStroops('7.5'))).toBe('7.5000000');
  });
});
