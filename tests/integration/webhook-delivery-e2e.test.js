'use strict';

/**
 * End-to-end webhook delivery integration tests (issue #1166).
 *
 * Webhook delivery is a multi-part subsystem — payload construction, signing,
 * transport, retry/backoff, and dead-lettering. Unit tests can't prove the
 * parts work together, and bugs here are consumer-facing and hard to notice
 * from the inside. These tests stand up a real local HTTP sink, point the
 * webhook subsystem at it, and assert the full delivery contract:
 *
 *   1. the delivered payload matches the documented schema and carries a
 *      signature that verifies with the documented HMAC-SHA256 algorithm/secret;
 *   2. transient failures (5xx) trigger retries with exponential backoff up to
 *      the capped attempt count;
 *   3. a permanent failure lands in the dead-letter queue with full context,
 *      and replaying it re-delivers successfully once the sink is healthy.
 */

const http = require('http');
const crypto = require('crypto');

const webhookService = require('../../src/services/WebhookService');
const { WebhookService } = webhookService;
const Database = require('../../src/utils/database');

// Mirrors the constants in WebhookService (not exported there).
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const RETRY_MAX_ATTEMPTS = 5;

/**
 * A minimal local HTTP server that records every delivery it receives and
 * replies with a configurable status code (or per-request status function).
 */
class WebhookSink {
  constructor() {
    this.requests = [];
    this.status = 200; // number, or (requestIndex) => number
    this.server = null;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          this.requests.push({
            method: req.method,
            headers: req.headers,
            body,
            at: Date.now(),
          });
          const code = typeof this.status === 'function'
            ? this.status(this.requests.length)
            : this.status;
          res.statusCode = code;
          res.end(code >= 200 && code < 300 ? 'ok' : 'error');
        });
      });
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
  }

  get port() { return this.server.address().port; }
  url(path = '/hook') { return `http://127.0.0.1:${this.port}${path}`; }
  bodies() { return this.requests.map((r) => JSON.parse(r.body)); }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}

/** Recompute the documented signature: HMAC-SHA256 over `${timestamp}.${body}`. */
function expectedSignature(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

describe('Webhook delivery — end-to-end', () => {
  let sink;

  beforeAll(async () => {
    await WebhookService.initTable();
    // The tls_skip_verify column is added by migration 020; the bare test
    // schema may not have it. Add it defensively so register() can insert.
    try {
      await Database.run('ALTER TABLE webhooks ADD COLUMN tls_skip_verify INTEGER NOT NULL DEFAULT 0');
    } catch (_) { /* column already exists */ }
  });

  beforeEach(async () => {
    // Isolate each test from the others.
    await Database.run('DELETE FROM webhooks');
    await Database.run('DELETE FROM webhook_retries');
    await Database.run('DELETE FROM webhook_dead_letters');
    await Database.run('DELETE FROM webhook_delivery_history');
    sink = new WebhookSink();
    await sink.start();
  });

  afterEach(async () => {
    await sink.stop();
  });

  async function registerWebhook(events) {
    const reg = await webhookService.register({ url: sink.url(), events });
    const row = await Database.get('SELECT * FROM webhooks WHERE id = ?', [reg.id]);
    return { reg, row };
  }

  test('delivers a well-formed, correctly-signed payload', async () => {
    sink.status = 200;
    const { reg, row } = await registerWebhook(['donation.created']);

    const payload = {
      donationId: 'd_123',
      amount: '10.5000000',
      currency: 'XLM',
      recipient: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST2345',
    };

    await WebhookService._deliverWithRetry(row, 'donation.created', payload, 0);

    expect(sink.requests).toHaveLength(1);
    const req = sink.requests[0];

    // Transport contract
    expect(req.method).toBe('POST');
    expect(req.headers['content-type']).toBe('application/json');

    // Documented payload schema
    const parsed = JSON.parse(req.body);
    expect(parsed).toEqual(
      expect.objectContaining({
        event: 'donation.created',
        data: payload,
        timestamp: expect.any(String),
        correlationContext: expect.any(Object),
      })
    );
    expect(() => new Date(parsed.timestamp).toISOString()).not.toThrow();

    // Signature verifies with the documented algorithm/secret
    const ts = req.headers['x-webhook-timestamp'];
    expect(ts).toBe(parsed.timestamp);
    const sig = expectedSignature(reg.secret, ts, req.body);
    expect(req.headers['x-webhook-signature']).toBe(`sha256=${sig}`);
    expect(req.headers['x-signature']).toBe(`sha256=${sig}`);

    // A wrong secret must NOT verify (guards against an empty/static secret).
    const wrong = expectedSignature('not-the-secret', ts, req.body);
    expect(req.headers['x-webhook-signature']).not.toBe(`sha256=${wrong}`);
  });

  test('retries transient 5xx failures with exponential backoff up to the capped attempt count', async () => {
    sink.status = 500; // permanently failing endpoint
    const { row } = await registerWebhook(['evt.retry']);

    await expect(
      WebhookService._deliverWithRetry(row, 'evt.retry', { n: 1 }, 0)
    ).rejects.toBeDefined();

    // Capped at MAX_RETRIES total attempts.
    expect(sink.requests).toHaveLength(MAX_RETRIES);

    // Backoff increases between attempts (1s, then 2s) — assert with margin.
    const gap1 = sink.requests[1].at - sink.requests[0].at;
    const gap2 = sink.requests[2].at - sink.requests[1].at;
    expect(gap1).toBeGreaterThanOrEqual(BASE_BACKOFF_MS * 0.8);
    expect(gap2).toBeGreaterThanOrEqual(BASE_BACKOFF_MS * 2 * 0.8);
    expect(gap2).toBeGreaterThan(gap1);
  }, 20000);

  test('promotes a permanently failed delivery to the dead-letter queue with full context', async () => {
    const { reg } = await registerWebhook(['evt.dlq']);
    const payload = { orderId: 'o_99', note: 'permanent failure' };

    // Drive the queue to its final attempt — scheduleRetry promotes to DLQ
    // once RETRY_MAX_ATTEMPTS is reached.
    await WebhookService.scheduleRetry({
      webhookId: reg.id,
      event: 'evt.dlq',
      payload,
      attempt: RETRY_MAX_ATTEMPTS,
      lastError: 'HTTP 500 (permanent)',
    });

    const deadLetters = await WebhookService.listDeadLetters({ limit: 50 });
    const entry = deadLetters.find((e) => e.webhookId === reg.id && e.event === 'evt.dlq');

    expect(entry).toBeDefined();
    expect(entry.payload).toEqual(payload); // full context preserved
    expect(entry.attempts).toBe(RETRY_MAX_ATTEMPTS);
    expect(entry.lastError).toBe('HTTP 500 (permanent)');
  });

  test('replaying a dead-letter re-delivers successfully once the sink is healthy', async () => {
    const { reg } = await registerWebhook(['evt.replay']);
    const payload = { invoiceId: 'inv_7', amount: '3.2500000' };

    // Land it in the DLQ first.
    await WebhookService.scheduleRetry({
      webhookId: reg.id,
      event: 'evt.replay',
      payload,
      attempt: RETRY_MAX_ATTEMPTS,
      lastError: 'gone',
    });
    const before = await WebhookService.listDeadLetters({ limit: 50 });
    const entry = before.find((e) => e.event === 'evt.replay');
    expect(entry).toBeDefined();

    // Sink is now healthy; replay re-queues the delivery.
    sink.status = 200;
    await WebhookService.replayDeadLetter(entry.id);

    // Replay schedules a fresh retry due in the future; simulate the delay
    // elapsing so the scheduler would pick it up now.
    await Database.run(
      'UPDATE webhook_retries SET next_retry_at = ? WHERE webhook_id = ?',
      [new Date(Date.now() - 1000).toISOString(), reg.id]
    );

    const result = await WebhookService.processRetryQueue();
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    // The replayed payload reached the healthy sink...
    const delivered = sink.bodies().find((b) => b.event === 'evt.replay');
    expect(delivered).toBeDefined();
    expect(delivered.data).toEqual(payload);

    // ...and the dead-letter entry is consumed.
    const after = await WebhookService.listDeadLetters({ limit: 50 });
    expect(after.find((e) => e.id === entry.id)).toBeUndefined();
  }, 20000);
});
