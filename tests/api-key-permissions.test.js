const request = require('supertest');
const app = require('../src/routes/app');
const { createApiKey, revokeApiKey } = require('../src/models/apiKeys');
const Database = require('../src/utils/database');

describe('API Key Permissions - Security Audit', () => {
  let adminKey, userKey, guestKey;
  let adminKeyId, userKeyId, guestKeyId;

  beforeAll(async () => {
    // Create test API keys for each role
    const admin = await createApiKey('Test Admin Key', 'admin', null);
    const user = await createApiKey('Test User Key', 'user', null);
    const guest = await createApiKey('Test Guest Key', 'guest', null);

    adminKey = admin.key;
    userKey = user.key;
    guestKey = guest.key;
    adminKeyId = admin.id;
    userKeyId = user.id;
    guestKeyId = guest.id;
  });

  afterAll(async () => {
    // Clean up test keys
    await revokeApiKey(adminKeyId);
    await revokeApiKey(userKeyId);
    await revokeApiKey(guestKeyId);
  });

  describe('Transaction Endpoints', () => {
    describe('GET /transactions', () => {
      it('should allow admin access', async () => {
        const res = await request(app)
          .get('/transactions')
          .set('x-api-key', adminKey);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should allow user access', async () => {
        const res = await request(app)
          .get('/transactions')
          .set('x-api-key', userKey);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should deny guest access', async () => {
        const res = await request(app)
          .get('/transactions')
          .set('x-api-key', guestKey);
        
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should deny unauthenticated access', async () => {
        const res = await request(app)
          .get('/transactions');
        
        expect(res.status).toBe(403); // attachUserRole sets guest role
      });
    });

    describe('POST /transactions/sync', () => {
      it('should allow user access with valid data', async () => {
        const res = await request(app)
          .post('/transactions/sync')
          .set('x-api-key', userKey)
          .send({ publicKey: 'GTEST123' });
        
        // May fail for other reasons but should pass auth
        expect(res.status).not.toBe(403);
      });

      it('should deny guest access', async () => {
        const res = await request(app)
          .post('/transactions/sync')
          .set('x-api-key', guestKey)
          .send({ publicKey: 'GTEST123' });
        
        expect(res.status).toBe(403);
      });
    });
  });

  describe('Stats Endpoints - All should allow stats:read', () => {
    const queryParams = '?startDate=2024-01-01&endDate=2024-12-31';

    it('GET /stats/daily - should allow user and guest', async () => {
      const userRes = await request(app)
        .get('/stats/daily' + queryParams)
        .set('x-api-key', userKey);
      expect(userRes.status).toBe(200);

      const guestRes = await request(app)
        .get('/stats/daily' + queryParams)
        .set('x-api-key', guestKey);
      expect(guestRes.status).toBe(200);
    });

    it('GET /stats/weekly - should allow user and guest', async () => {
      const userRes = await request(app)
        .get('/stats/weekly' + queryParams)
        .set('x-api-key', userKey);
      expect(userRes.status).toBe(200);

      const guestRes = await request(app)
        .get('/stats/weekly' + queryParams)
        .set('x-api-key', guestKey);
      expect(guestRes.status).toBe(200);
    });

    it('GET /stats/summary - should allow user and guest', async () => {
      const userRes = await request(app)
        .get('/stats/summary' + queryParams)
        .set('x-api-key', userKey);
      expect(userRes.status).toBe(200);

      const guestRes = await request(app)
        .get('/stats/summary' + queryParams)
        .set('x-api-key', guestKey);
      expect(guestRes.status).toBe(200);
    });
  });

  describe('Donation Endpoints', () => {
    describe('POST /donations - requires donations:create', () => {
      it('should allow user to create', async () => {
        const res = await request(app)
          .post('/donations')
          .set('x-api-key', userKey)
          .set('x-idempotency-key', 'test-user-' + Date.now())
          .send({
            donorPublicKey: 'GTEST1',
            recipientPublicKey: 'GTEST2',
            amount: 10
          });
        
        // Should pass auth (may fail validation)
        expect(res.status).not.toBe(403);
      });

      it('should deny guest creation', async () => {
        const res = await request(app)
          .post('/donations')
          .set('x-api-key', guestKey)
          .set('x-idempotency-key', 'test-guest-' + Date.now())
          .send({
            donorPublicKey: 'GTEST1',
            recipientPublicKey: 'GTEST2',
            amount: 10
          });
        
        expect(res.status).toBe(401); // requireApiKey blocks it
      });
    });

    describe('GET /donations - requires donations:read', () => {
      it('should allow all roles to read', async () => {
        const guestRes = await request(app)
          .get('/donations')
          .set('x-api-key', guestKey);
        expect(guestRes.status).toBe(200);
      });
    });
  });

  describe('Wallet Endpoints', () => {
    describe('POST /wallets - requires wallets:create', () => {
      it('should allow user to create', async () => {
        const res = await request(app)
          .post('/wallets')
          .set('x-api-key', userKey)
          .send({ address: 'GTEST_USER_' + Date.now() });
        
        expect([200, 201, 400, 409]).toContain(res.status);
      });

      it('should deny guest creation', async () => {
        const res = await request(app)
          .post('/wallets')
          .set('x-api-key', guestKey)
          .send({ address: 'GTEST_GUEST_' + Date.now() });
        
        expect(res.status).toBe(403);
      });
    });
  });

  describe('Stream Endpoints', () => {
    describe('POST /stream/create - requires stream:create', () => {
      it('should allow user to create', async () => {
        const res = await request(app)
          .post('/stream/create')
          .set('x-api-key', userKey)
          .send({
            donorPublicKey: 'GTEST1',
            recipientPublicKey: 'GTEST2',
            amount: 5,
            frequency: 'daily'
          });
        
        // Should pass auth
        expect(res.status).not.toBe(403);
      });

      it('should deny guest creation', async () => {
        const res = await request(app)
          .post('/stream/create')
          .set('x-api-key', guestKey)
          .send({
            donorPublicKey: 'GTEST1',
            recipientPublicKey: 'GTEST2',
            amount: 5,
            frequency: 'daily'
          });
        
        expect(res.status).toBe(403);
      });
    });
  });

  describe('API Keys Endpoints - Admin Only', () => {
    describe('GET /api-keys', () => {
      it('should allow admin access', async () => {
        const res = await request(app)
          .get('/api-keys')
          .set('x-api-key', adminKey);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should deny user access', async () => {
        const res = await request(app)
          .get('/api-keys')
          .set('x-api-key', userKey);
        
        expect(res.status).toBe(403);
      });

      it('should deny guest access', async () => {
        const res = await request(app)
          .get('/api-keys')
          .set('x-api-key', guestKey);
        
        expect(res.status).toBe(403);
      });
    });
  });

  describe('Permission Escalation Prevention', () => {
    it('should not allow user to create admin API keys', async () => {
      const res = await request(app)
        .post('/api-keys')
        .set('x-api-key', userKey)
        .send({ name: 'Unauthorized Key', role: 'admin' });
      
      expect(res.status).toBe(403);
    });

    it('should not allow guest to access write endpoints', async () => {
      const writeEndpoints = [
        { method: 'post', path: '/donations', body: { amount: 10 } },
        { method: 'post', path: '/wallets', body: { address: 'TEST' } },
        { method: 'post', path: '/stream/create', body: { amount: 5 } }
      ];

      for (const endpoint of writeEndpoints) {
        const res = await request(app)[endpoint.method](endpoint.path)
          .set('x-api-key', guestKey)
          .send(endpoint.body);
        
        expect([401, 403]).toContain(res.status);
      }
    });
  });
});
