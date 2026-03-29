const express = require('express');
const router = express.Router();
const Transaction = require('../models/transaction');
const TransactionSyncService = require('../../services/TransactionSyncService');
const { buildErrorResponse } = require('../../utils/validationErrorFormatter');



router.get('/', async (req, res) => {
  try {
    let { limit = 10, offset = 0 } = req.query;

    
    limit = parseInt(limit);
    offset = parseInt(offset);

    
    if (isNaN(limit) || limit <= 0) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'INVALID_LIMIT', receivedValue: req.query.limit }])
      );
    }

    if (isNaN(offset) || offset < 0) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'INVALID_OFFSET', receivedValue: req.query.offset }])
      );
    }

    const result = Transaction.getPaginated({ limit, offset });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch transactions'
      }
    });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const { publicKey } = req.body;

    if (!publicKey) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_PUBLIC_KEY', receivedValue: publicKey }])
      );
    }

    const syncService = new TransactionSyncService();
    const result = await syncService.syncWalletTransactions(publicKey);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SYNC_FAILED', message: error.message }
    });
  }
});


module.exports = router;