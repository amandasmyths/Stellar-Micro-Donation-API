const request = require('supertest');
const express = require('express');
const Cache = require('../src/utils/cache');
const { createDeduplicationMiddleware } = require('../src/middleware/deduplication');

function buildTestApp(options) {
  const app = express();
  app.use(express.json());
  app.use(createDeduplicationMiddleware(options));
  app.post('/test', (req, res) => {
    res.status(201).json({ success: true, data: { id: 1 } });
  });
  app.put('/test', (req, res) => {
    res.status(200).json({ success: true, data: { updated: true } });
  });
  app.patch('/test', (req, res) => {
    res.status(200).json({ success: true, data: { patched: true } });
  });
  app.get('/test', (req, res) => {
    res.status(200).json({ success: true, data: { list: [] } });
  });
  app.post('/other', (req, res) => {
    res.status(201).json({ success: true, data: { id: 2 } });
  });
  app.post('/error', (req, res) => {
    res.status(400).json({ success: false, error: { message: 'Bad request' } });
  });
  return app;
}

describe('Request Deduplication Middleware', () => {
  beforeEach(() => {
    Cache.clearPrefix('dedup:');
  });
  describe('cache miss and cache hit', () => {
    test('first request passes through and returns normally', async () => {
      const app = buildTestApp();
      const res = await request(app)
        .post('/test')
        .send({ amount: 10 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: { id: 1 } });
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });

    test('identical second request within 30s returns cached response with X-Deduplicated header', async () => {
      const app = buildTestApp();
      const body = { amount: 10 };

      await request(app).post('/test').send(body);
      const res = await request(app).post('/test').send(body);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: { id: 1 } });
      expect(res.headers['x-deduplicated']).toBe('true');
    });
  });
});
