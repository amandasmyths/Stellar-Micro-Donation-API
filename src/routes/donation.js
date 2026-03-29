const express = require('express');
const router = express.Router();
const StellarService = require('../services/StellarService');
const Transaction = require('./models/transaction');
const donationValidator = require('../utils/donationValidator');
const { buildErrorResponse } = require('../utils/validationErrorFormatter');

/**
 * POST /api/v1/donation/verify
 * Verify a donation transaction by hash
 */
router.post('/verify', async (req, res) => {
  try {
    const { transactionHash } = req.body;

    if (!transactionHash) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_TRANSACTION_HASH', receivedValue: transactionHash }])
      );
    }

    const result = await stellarService.verifyTransaction(transactionHash);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /donations
 * Create a new donation
 */
router.post('/', (req, res) => {
  try {

    const idempotencyKey = req.headers['idempotency-key'];

     if (!idempotencyKey) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_IDEMPOTENCY_KEY', receivedValue: undefined }])
      );
    }

    const { amount, donor, recipient } = req.body;

    if (!amount || !recipient) {
      const errors = [];
      if (!amount) errors.push({ code: 'MISSING_AMOUNT', receivedValue: amount });
      if (!recipient) errors.push({ code: 'MISSING_RECIPIENT', receivedValue: recipient });
      return res.status(400).json(buildErrorResponse(errors));
    }

    const parsedAmount = parseFloat(amount);

    // Validate amount type and basic checks
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json(
        buildErrorResponse([{ code: parsedAmount <= 0 ? 'AMOUNT_TOO_LOW' : 'INVALID_AMOUNT_TYPE', receivedValue: amount }])
      );
    }

    // Validate amount against configured limits
    const amountValidation = donationValidator.validateAmount(parsedAmount);
    if (!amountValidation.valid) {
      return res.status(400).json(
        buildErrorResponse([{ code: amountValidation.code, receivedValue: parsedAmount }])
      );
    }

    // Validate daily limit if donor is specified
    if (donor && donor !== 'Anonymous') {
      const dailyTotal = Transaction.getDailyTotalByDonor(donor);
      const dailyValidation = donationValidator.validateDailyLimit(parsedAmount, dailyTotal);
      
      if (!dailyValidation.valid) {
        return res.status(400).json(
          buildErrorResponse([{ code: dailyValidation.code, receivedValue: parsedAmount }])
        );
      }
    }

    const normalizedDonor = typeof donor === 'string' ? donor.trim() : '';
    const normalizedRecipient = typeof recipient === 'string' ? recipient.trim() : '';

    if (normalizedDonor && normalizedRecipient && normalizedDonor === normalizedRecipient) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'SAME_SENDER_RECIPIENT', receivedValue: recipient }])
      );
    }

    // Calculate analytics fee (not deducted on-chain)
    const donationAmount = parseFloat(amount);
    const feeCalculation = calculateAnalyticsFee(donationAmount);

    const transaction = Transaction.create({
      amount: parsedAmount,
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
    res.status(500).json({
      error: 'Failed to create donation',
      message: error.message
    });
  }
});

/**
 * GET /donations
 * Get all donations
 */
router.get('/', (req, res) => {
  try {
    const transactions = Transaction.getAll();
    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve donations',
      message: error.message
    });
  }
});

/**
 * GET /donations/limits
 * Get current donation amount limits
 */
router.get('/limits', (req, res) => {
  try {
    const limits = donationValidator.getLimits();
    res.json({
      success: true,
      data: {
        minAmount: limits.minAmount,
        maxAmount: limits.maxAmount,
        maxDailyPerDonor: limits.maxDailyPerDonor,
        currency: 'XLM',
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve limits',
      message: error.message
    });
  }
});

/**
 * GET /donations/recent
 * Get recent donations (read-only, no sensitive data)
 * Query params:
 *   - limit: number of recent donations to return (default: 10, max: 100)
 */
router.get('/recent', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);

    if (isNaN(limit) || limit < 1) {
      return res.status(400).json({
        error: 'Invalid limit parameter. Must be a positive number.'
      });
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
    res.status(500).json({
      error: 'Failed to retrieve recent donations',
      message: error.message
    });
  }
});

/**
 * GET /donations/:id
 * Get a specific donation
 */
router.get('/:id', (req, res) => {
  try {
    const transaction = Transaction.getById(req.params.id);
    
    if (!transaction) {
      return res.status(404).json({
        error: 'Donation not found'
      });
    }

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve donation',
      message: error.message
    });
  }
});

/**
 * PATCH /donations/:id/status
 * Update donation transaction status
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, stellarTxId, ledger } = req.body;

    if (!status) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_STATUS', receivedValue: status }])
      );
    }

    const validStatuses = ['pending', 'confirmed', 'failed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'INVALID_STATUS', receivedValue: status }])
      );
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
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message
      });
    }
    res.status(500).json({
      error: 'Failed to update transaction status',
      message: error.message
    });
  }
});

module.exports = router;
