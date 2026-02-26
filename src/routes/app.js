/**
 * Application Entry Point
 * 
 * RESPONSIBILITY: Express server initialization, middleware orchestration, and lifecycle management
 * OWNER: Backend Team
 * DEPENDENCIES: All middleware, routes, and core services
 * 
 * This module bootstraps the Express application, configures middleware pipeline,
 * registers API routes, and manages graceful startup/shutdown of background services.
 */

const express = require('express');
const config = require('../config');
const stellarConfig = require('../config/stellar');
const donationRoutes = require('./donation');
const walletRoutes = require('./wallet');
const statsRoutes = require('./stats');
const streamRoutes = require('./stream');
const transactionRoutes = require('./transaction');
const apiKeysRoutes = require('./apiKeys');
const { errorHandler, notFoundHandler } = require('../middleware/errorHandler');
const logger = require('../middleware/logger');
const { attachUserRole } = require('../middleware/rbac');
const abuseDetectionMiddleware = require('../middleware/abuseDetection');
const { payloadSizeLimiter } = require('../middleware/payloadSizeLimit');
const Database = require('../utils/database');
const { initializeApiKeysTable } = require('../models/apiKeys');
const { validateRBAC } = require('../utils/rbacValidator');
const log = require('../utils/log');
const requestId = require('../middleware/requestId');
const {
  logStartupDiagnostics,
  logShutdownDiagnostics,
} = require("../utils/startupDiagnostics");

const app = express();

// Initialize services from container
const stellarService = serviceContainer.getStellarService();
const reconciliationService = serviceContainer.getTransactionReconciliationService();
const recurringDonationScheduler = serviceContainer.getRecurringDonationScheduler();

// Middleware
app.use(requestId);

// Payload size limit (must be before body parsers)
app.use(payloadSizeLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request/Response logging middleware
app.use(logger.middleware());

// Abuse detection (observability only - no blocking)
app.use(abuseDetectionMiddleware);

// Attach user role from authentication (must be before routes)
app.use(attachUserRole());

// Routes
app.use('/wallets', walletRoutes);
app.use('/donations', donationRoutes);
app.use('/stats', statsRoutes);
app.use('/stream', streamRoutes);
app.use('/transactions', transactionRoutes);
app.use('/api-keys', apiKeysRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await Database.get('SELECT 1 as ok');
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: 'ok'
      },
      services: {
        recurringDonations: recurringDonationScheduler.getStatus(),
        reconciliation: reconciliationService.getStatus()
      }
    });
  } catch (error) {
    next(error);
  }
});

// Abuse detection stats endpoint (admin only)
app.get('/abuse-signals', require('../middleware/rbac').requireAdmin(), (req, res) => {
  const abuseDetector = require('../utils/abuseDetector');

  res.json({
    success: true,
    data: abuseDetector.getStats(),
    timestamp: new Date().toISOString()
  });
});

// Manual reconciliation trigger (admin only)
app.post('/reconcile', require('../middleware/rbac').requireAdmin(), async (req, res) => {
  try {
    if (reconciliationService.reconciliationInProgress) {
      return res.status(409).json({
        success: false,
        error: 'Reconciliation already in progress'
      });
    }
    // Trigger reconciliation without waiting
    reconciliationService.reconcile().catch(error => {
      log.error('APP', 'Manual reconciliation failed', { error: error.message });
    });
    res.json({
      success: true,
      message: 'Reconciliation started',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error('APP', 'Unhandled promise rejection', {
    reason,
    promise,
    timestamp: new Date().toISOString()
  });
});

const PORT = config.server.port;

async function startServer() {
  try {
    // Log startup diagnostics first
    await logStartupDiagnostics();

    // Initialize database and API keys
    await Database.initialize();
    await initializeApiKeysTable();
    await validateRBAC();

    const server = app.listen(PORT, async () => {
      // Start background services
      recurringDonationScheduler.start();
      reconciliationService.start();

  app.listen(PORT, () => {
    log.info('APP', 'API started', {
      port: PORT,
      network: config.network,
      healthCheck: `http://localhost:${PORT}/health`
    });

    if (log.isDebugMode) {
      log.debug('APP', 'Debug mode enabled - verbose logging active');
      log.debug('APP', 'Configuration loaded', {
        port: PORT,
        network: stellarConfig.network,
        healthCheck: `http://localhost:${PORT}/health`,
        environment: config.server.env,
      });
    });

    // Start the recurring donation scheduler
    recurringDonationScheduler.start();

    // Start the transaction reconciliation service
    reconciliationService.start();
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
