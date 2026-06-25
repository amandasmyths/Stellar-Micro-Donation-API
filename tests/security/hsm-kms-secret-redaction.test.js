'use strict';

/**
 * Leak-scan tests for HSM/KMS credentials.
 *
 * Verifies that HSM_PIN, HSM_SLOT_ID, KMS_KEY_ID, and KMS_PROVIDER never
 * appear in serialized log metadata, the startup diagnostics dump, or error
 * messages produced by the codebase.
 */

const { isSensitiveKey, maskSensitiveData, SENSITIVE_PATTERNS } = require('../../src/utils/dataMasker');
const { getFeaturesInfo } = require('../../src/utils/startupDiagnostics');

const SECRET_VALUES = {
  HSM_PIN: 'super-secret-hsm-pin-1234',
  HSM_SLOT_ID: '7',
  KMS_KEY_ID: 'arn:aws:kms:us-east-1:123456789012:key/abc-123',
  KMS_PROVIDER: 'aws',
};

// === Pattern registration

describe('SENSITIVE_PATTERNS coverage', () => {
  const cases = [
    'hsm_pin', 'hsmpin',
    'hsm_slot_id', 'hsmslotid', 'hsm_slot', 'hsmslot',
    'kms_key_id', 'kmskeyid', 'kms_key', 'kmskey',
    'kms_provider', 'kmsprovider',
  ];

  test.each(cases)('SENSITIVE_PATTERNS includes "%s"', (pattern) => {
    expect(SENSITIVE_PATTERNS).toContain(pattern);
  });
});

// === isSensitiveKey detection

describe('isSensitiveKey', () => {
  const sensitiveKeys = [
    'HSM_PIN', 'hsm_pin', 'hsmPin', 'HSM-PIN',
    'HSM_SLOT_ID', 'hsm_slot_id', 'hsmSlotId',
    'KMS_KEY_ID', 'kms_key_id', 'kmsKeyId', 'KMS-KEY-ID',
    'KMS_PROVIDER', 'kms_provider', 'kmsProvider',
  ];

  test.each(sensitiveKeys)('detects "%s" as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });
});

// === maskSensitiveData redaction

describe('maskSensitiveData redacts HSM/KMS fields', () => {
  it('redacts all four fields at the top level', () => {
    const result = maskSensitiveData({ ...SECRET_VALUES });
    expect(result.HSM_PIN).toBe('[REDACTED]');
    expect(result.HSM_SLOT_ID).toBe('[REDACTED]');
    expect(result.KMS_KEY_ID).toBe('[REDACTED]');
    expect(result.KMS_PROVIDER).toBe('[REDACTED]');
  });

  it('redacts nested HSM/KMS fields', () => {
    const result = maskSensitiveData({
      config: { hsm: { hsm_pin: SECRET_VALUES.HSM_PIN } },
      kms: { kms_key_id: SECRET_VALUES.KMS_KEY_ID },
    });
    expect(result.config.hsm.hsm_pin).toBe('[REDACTED]');
    expect(result.kms.kms_key_id).toBe('[REDACTED]');
  });

  it('redacts camelCase variants', () => {
    const result = maskSensitiveData({
      hsmPin: SECRET_VALUES.HSM_PIN,
      kmsKeyId: SECRET_VALUES.KMS_KEY_ID,
      kmsProvider: SECRET_VALUES.KMS_PROVIDER,
    });
    expect(result.hsmPin).toBe('[REDACTED]');
    expect(result.kmsKeyId).toBe('[REDACTED]');
    expect(result.kmsProvider).toBe('[REDACTED]');
  });

  it('serialized JSON does not contain raw secret values', () => {
    const serialized = JSON.stringify(maskSensitiveData({ ...SECRET_VALUES }));
    for (const value of Object.values(SECRET_VALUES)) {
      expect(serialized).not.toContain(value);
    }
  });
});

// === Startup diagnostics leak scan

describe('startupDiagnostics getFeaturesInfo', () => {
  const origEnv = {};

  beforeAll(() => {
    for (const key of Object.keys(SECRET_VALUES)) {
      origEnv[key] = process.env[key];
      process.env[key] = SECRET_VALUES[key];
    }
  });

  afterAll(() => {
    for (const key of Object.keys(SECRET_VALUES)) {
      if (origEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = origEnv[key];
      }
    }
  });

  it('does not include raw HSM_PIN in the features dump', () => {
    const features = getFeaturesInfo();
    const serialized = JSON.stringify(features);
    expect(serialized).not.toContain(SECRET_VALUES.HSM_PIN);
  });

  it('does not include raw KMS_KEY_ID in the features dump', () => {
    const features = getFeaturesInfo();
    const serialized = JSON.stringify(features);
    expect(serialized).not.toContain(SECRET_VALUES.KMS_KEY_ID);
  });

  it('does not include raw KMS_PROVIDER value in the features dump', () => {
    const features = getFeaturesInfo();
    // KMS_PROVIDER value ('aws') is intentionally not included; only a boolean presence flag
    expect(features.kms.providerConfigured).toBe(true);
    expect(features.kms).not.toHaveProperty('provider');
  });

  it('reports HSM/KMS presence as booleans only', () => {
    const { kms, hsm } = getFeaturesInfo();
    expect(typeof kms.providerConfigured).toBe('boolean');
    expect(typeof kms.keyConfigured).toBe('boolean');
    expect(typeof hsm.slotConfigured).toBe('boolean');
    expect(typeof hsm.pinConfigured).toBe('boolean');
  });
});
