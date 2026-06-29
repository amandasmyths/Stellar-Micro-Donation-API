'use strict';

/**
 * Shared Stellar service contract (issue #1164)
 * ─────────────────────────────────────────────
 * StellarServiceInterface is the formal contract that BOTH the in-memory
 * MockStellarService (tests/dev) and the real StellarService (production)
 * promise to honour. If the two drift apart in signature, return shape, or
 * error behaviour, the test suite passes against the mock while production
 * behaves differently — the worst kind of false confidence for a payments
 * system.
 *
 * This module exports a SINGLE contract that `stellarService.contract.test.js`
 * runs against both implementations, so a divergence from the interface or
 * from the shared behavioural expectations fails CI.
 *
 * The contract has two layers:
 *   1. Structural conformance — every interface method is present, both
 *      classes are instances of the interface, and the arity of each method
 *      matches the contract (a changed signature is drift).
 *   2. Behavioural conformance — for methods that are deterministic offline
 *      (no live Horizon required) we assert the actual return shapes and
 *      error contracts, not merely that the method exists.
 *
 * Methods whose behaviour can only be exercised against a live/sandbox
 * Horizon are gated behind capability flags so the same suite runs cleanly
 * against the mock (full behaviour) and the real service (structure + the
 * offline-deterministic subset).
 */

const StellarServiceInterface = require('../../src/services/interfaces/StellarServiceInterface');

/**
 * The canonical method surface of the contract, derived from the interface.
 * `arity` is the declared parameter count of the interface method and is the
 * single source of truth a signature change is measured against.
 *
 * `offlinePure` marks methods that return deterministically without any
 * network access — these are exercised behaviourally against every
 * implementation that overrides them.
 */
const OFFLINE_PURE = new Set([
  'isValidAddress',
  'stroopsToXlm',
  'xlmToStroops',
  'getNetwork',
  'getHorizonUrl',
]);

const CONTRACT_METHODS = (() => {
  const proto = StellarServiceInterface.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .map((name) => ({
      name,
      arity: proto[name].length,
      offlinePure: OFFLINE_PURE.has(name),
    }));
})();

/**
 * Documented divergences from the interface that exist in the codebase TODAY.
 * Each entry is an explicit, reviewed exception — NOT a licence to drift. The
 * structural contract treats anything NOT listed here as a failure, so:
 *   - adding a new interface method without implementing it,
 *   - changing the arity of a conformant method, or
 *   - introducing a brand-new mock/real mismatch
 * all fail CI. Closing one of these gaps (good!) also fails CI, prompting the
 * entry to be removed — keeping this list honest over time.
 *
 * shape: { method: { mock?: <verdict>, real?: <verdict> } } where <verdict> is
 *   - 'inherited' : the implementation does not override the interface method
 *                   (it inherits the throwing stub).
 *   - 'arity:N'   : the implementation overrides the method but with declared
 *                   arity N instead of the interface's arity.
 */
const KNOWN_DIVERGENCES = {
  // Real service delegates raw account/transaction access to the Stellar SDK
  // `server` object and does not expose these as its own methods offline.
  loadAccount: { real: 'inherited' },
  submitTransaction: { real: 'inherited' },
  buildPaymentTransaction: { real: 'inherited' },
  getAccountSequence: { real: 'inherited' },
  buildTransaction: { real: 'inherited' },
  signTransaction: { real: 'inherited' },
  getTransaction: { real: 'inherited' },
  // Pure helpers implemented on the mock; the real service relies on the
  // shared validation/util layer rather than class methods.
  isValidAddress: { real: 'inherited' },
  stroopsToXlm: { real: 'inherited' },
  xlmToStroops: { real: 'inherited' },
  getTrustlines: { real: 'inherited' },
  // deleteAccountData is implemented on the real service but not the mock.
  deleteAccountData: { mock: 'inherited' },
  // setOptions: both override with a default-valued options param (arity 1).
  setOptions: { mock: 'arity:1', real: 'arity:1' },
  // Trustline management drifted to a richer signature on both implementations
  // (accountSecret, assetCode, issuerPublic, [limit]); the interface still
  // documents the older (publicKey, asset) shape.
  addTrustline: { mock: 'arity:3', real: 'arity:3' },
  // removeTrustline: only the real service adopted the richer signature.
  removeTrustline: { real: 'arity:3' },
};

/** Walk the prototype chain to find the prototype object that owns `method`. */
function findOwningProto(instance, method) {
  let proto = Object.getPrototypeOf(instance);
  while (proto) {
    if (Object.prototype.hasOwnProperty.call(proto, method)) return proto;
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

/** Does this implementation override (vs inherit) the interface method? */
function overridesMethod(instance, method) {
  const owner = findOwningProto(instance, method);
  return owner !== null && owner !== StellarServiceInterface.prototype;
}

/**
 * Resolve the contractually expected verdict for a method on one
 * implementation, taking the documented divergences into account.
 * @returns {{ kind: 'inherited' } | { kind: 'arity', arity: number }}
 */
function expectedVerdict(methodName, impl /* 'mock' | 'real' */, canonicalArity) {
  const divergence = (KNOWN_DIVERGENCES[methodName] || {})[impl];
  if (divergence === 'inherited') {
    return { kind: 'inherited' };
  }
  if (typeof divergence === 'string' && divergence.startsWith('arity:')) {
    return { kind: 'arity', arity: parseInt(divergence.slice('arity:'.length), 10) };
  }
  return { kind: 'arity', arity: canonicalArity };
}

/**
 * Run the shared contract against one implementation.
 *
 * @param {Object} opts
 * @param {string} opts.name           - Human label, e.g. "MockStellarService"
 * @param {'mock'|'real'} opts.impl    - Which side of the divergence map applies
 * @param {() => Object} opts.createService - Factory returning a fresh instance
 * @param {Object} [opts.capabilities] - Behavioural capability flags
 * @param {boolean} [opts.capabilities.offlineWallets] - In-memory wallet
 *        behaviour is available (full behavioural contract).
 */
function runStellarServiceContract({ name, impl, createService, capabilities = {} }) {
  const { offlineWallets = false } = capabilities;

  describe(`StellarServiceInterface contract — ${name}`, () => {
    let service;
    beforeEach(() => {
      service = createService();
    });

    describe('structural conformance', () => {
      test('is an instance of StellarServiceInterface', () => {
        expect(service).toBeInstanceOf(StellarServiceInterface);
      });

      test.each(CONTRACT_METHODS.map((m) => [m.name]))(
        'exposes %s() as a callable',
        (methodName) => {
          expect(typeof service[methodName]).toBe('function');
        }
      );

      test.each(CONTRACT_METHODS.map((m) => [m.name, m]))(
        'method %s() conforms to the contract signature/presence',
        (methodName, meta) => {
          const verdict = expectedVerdict(methodName, impl, meta.arity);

          if (verdict.kind === 'inherited') {
            // Documented gap: the implementation inherits the throwing stub.
            expect(overridesMethod(service, methodName)).toBe(false);
            return;
          }

          // Implementation must override the interface method...
          expect(overridesMethod(service, methodName)).toBe(true);
          // ...with the contractually expected arity.
          expect(service[methodName].length).toBe(verdict.arity);
        }
      );
    });

    describe('behavioural conformance — offline-pure methods', () => {
      const offline = CONTRACT_METHODS.filter((m) => m.offlinePure);

      for (const meta of offline) {
        const supported = overridesMethod(createService(), meta.name);
        const maybe = supported ? describe : describe.skip;

        maybe(`${meta.name}()`, () => {
          if (meta.name === 'getNetwork') {
            test('returns a non-empty network identifier string', () => {
              expect(typeof service.getNetwork()).toBe('string');
              expect(service.getNetwork().length).toBeGreaterThan(0);
            });
          }

          if (meta.name === 'getHorizonUrl') {
            test('returns a parseable Horizon URL', () => {
              const url = service.getHorizonUrl();
              expect(typeof url).toBe('string');
              expect(() => new URL(url)).not.toThrow();
            });
          }

          if (meta.name === 'isValidAddress') {
            test('accepts a well-formed public key and rejects malformed input', () => {
              const valid = 'G' + 'A'.repeat(55);
              expect(service.isValidAddress(valid)).toBe(true);
              expect(service.isValidAddress('not-a-key')).toBe(false);
              expect(service.isValidAddress('')).toBe(false);
              expect(service.isValidAddress(null)).toBe(false);
            });
          }

          if (meta.name === 'stroopsToXlm') {
            test('converts integer stroops to a 7-dp XLM string', () => {
              expect(service.stroopsToXlm(10_000_000)).toBe('1.0000000');
              expect(service.stroopsToXlm(1)).toBe('0.0000001');
              expect(service.stroopsToXlm(0)).toBe('0.0000000');
            });
            test('rejects non-numeric input with an error', () => {
              expect(() => service.stroopsToXlm('not-a-number')).toThrow();
            });
          }

          if (meta.name === 'xlmToStroops') {
            test('converts an XLM amount to an integer stroop string', () => {
              expect(service.xlmToStroops('1')).toBe('10000000');
              expect(service.xlmToStroops('0.0000001')).toBe('1');
            });
            test('rejects non-numeric input with an error', () => {
              expect(() => service.xlmToStroops('not-a-number')).toThrow();
            });
            test('round-trips with stroopsToXlm', () => {
              const xlm = '12.3456789';
              expect(service.stroopsToXlm(service.xlmToStroops(xlm))).toBe('12.3456789');
            });
          }
        });
      }
    });

    // The full behavioural contract (return shapes + error contracts for
    // wallet/transaction operations) is only deterministic offline against the
    // in-memory implementation. The real service exercises these paths in its
    // own integration suites against a sandbox/recorded Horizon.
    const walletSuite = offlineWallets ? describe : describe.skip;
    walletSuite('behavioural conformance — wallet/transaction operations', () => {
      const validAddr = 'G' + 'A'.repeat(55);

      test('loadAccount() rejects an invalid address with an error', async () => {
        await expect(service.loadAccount('bad')).rejects.toThrow();
      });

      test('loadAccount() returns the documented account shape for a known wallet', async () => {
        service.wallets.set(validAddr, { sequence: '42', balance: '100.0000000' });
        const account = await service.loadAccount(validAddr);
        expect(typeof account.accountId).toBe('function');
        expect(account.accountId()).toBe(validAddr);
        expect(typeof account.sequenceNumber).toBe('function');
        expect(Array.isArray(account.balances)).toBe(true);
      });

      test('getAccountSequence() rejects an invalid address', async () => {
        await expect(service.getAccountSequence('bad')).rejects.toThrow();
      });

      test('submitSignedTransaction() returns {transactionId, hash, ledger}', async () => {
        const result = await service.submitSignedTransaction('AAAA-fake-xdr');
        expect(result).toEqual(
          expect.objectContaining({
            transactionId: expect.any(String),
            hash: expect.any(String),
            ledger: expect.any(Number),
          })
        );
      });

      test('submitSignedTransaction() rejects empty input with an error', async () => {
        await expect(service.submitSignedTransaction('')).rejects.toThrow();
      });

      test('buildPaymentTransaction() rejects an invalid source key', async () => {
        await expect(
          service.buildPaymentTransaction('bad', validAddr, '10')
        ).rejects.toThrow();
      });
    });
  });
}

module.exports = {
  runStellarServiceContract,
  CONTRACT_METHODS,
  KNOWN_DIVERGENCES,
  overridesMethod,
};
