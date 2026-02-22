const express = require('express');
const router = express.Router();
const StellarService = require('../services/StellarService');
const Transaction = require('./models/transaction');
const Wallet = require('./models/wallet');
const { ValidationError, NotFoundError, InternalError, ERROR_CODES } = require('../utils/errors');

const stellarService = new StellarService({
  network: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'
});

/**
 * POST /api/v1/donation/verify
 * Verify a donation transaction by hash
 */
router.post('/verify', async (req, res, next) => {
  try {
    const { transactionHash } = req.body;

    if (!transactionHash) {
      throw new ValidationError('Transaction hash is required', null, ERROR_CODES.INVALID_REQUEST);
    }

    const result = await stellarService.verifyTransaction(transactionHash);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /donations
 * Create a new donation
 */
router.post('/', (req, res, next) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey) {
      throw new ValidationError('Idempotency key is required', null, ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED);
    }

    const { amount, donor, recipient } = req.body;

    if (!amount || !recipient) {
      throw new ValidationError('Missing required fields: amount, recipient', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      throw new ValidationError('Amount must be a positive number', null, ERROR_CODES.INVALID_AMOUNT);
    }

    const normalizedDonor = typeof donor === 'string' ? donor.trim() : '';
    const normalizedRecipient = typeof recipient === 'string' ? recipient.trim() : '';

    if (normalizedDonor && normalizedRecipient && normalizedDonor === normalizedRecipient) {
      throw new ValidationError('Sender and recipient wallets must be different');
    }

    // Calculate analytics fee (not deducted on-chain)
    const donationAmount = parseFloat(amount);
    const feeCalculation = calculateAnalyticsFee(donationAmount);

    const transaction = Transaction.create({
      amount: donationAmount,
      donor: donor || 'Anonymous',
      recipient,
      idempotencyKey,
      analyticsFee: feeCalculation.fee,
      analyticsFeePercentage: feeCalculation.feePercentage
    });

    res.status(201).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations
 * Get all donations
 */
router.get('/', (req, res, next) => {
  try {
    const transactions = Transaction.getAll();
    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/recent
 * Get recent donations (read-only, no sensitive data)
 * Query params:
 *   - limit: number of recent donations to return (default: 10, max: 100)
 */
router.get('/recent', (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);

    if (isNaN(limit) || limit < 1) {
      throw new ValidationError('Invalid limit parameter. Must be a positive number.', null, ERROR_CODES.INVALID_LIMIT);
    }

    const transactions = Transaction.getAll();
    
    // Sort by timestamp descending (most recent first)
    const sortedTransactions = transactions
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    // Remove sensitive data: stellarTxId is not exposed
    const sanitizedTransactions = sortedTransactions.map(tx => ({
      id: tx.id,
      amount: tx.amount,
      donor: tx.donor,
      recipient: tx.recipient,
      timestamp: tx.timestamp,
      status: tx.status
    }));

    res.json({
      success: true,
      data: sanitizedTransactions,
      count: sanitizedTransactions.length,
      limit: limit
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/:id
 * Get a specific donation
 */
router.get('/:id', (req, res, next) => {
  try {
    const transaction = Transaction.getById(req.params.id);
    
    if (!transaction) {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
    }

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /donations/:id/status
 * Update donation transaction status
 */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, stellarTxId, ledger } = req.body;

    if (!status) {
      throw new ValidationError('Missing required field: status', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    const validStatuses = ['pending', 'confirmed', 'failed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const stellarData = {};
    if (stellarTxId) stellarData.transactionId = stellarTxId;
    if (ledger) stellarData.ledger = ledger;
    if (status === 'confirmed') stellarData.confirmedAt = new Date().toISOString();

    const updatedTransaction = Transaction.updateStatus(id, status, stellarData);

    res.json({
      success: true,
      data: updatedTransaction
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
