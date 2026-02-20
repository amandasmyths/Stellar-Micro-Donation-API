const fs = require('fs');
const path = require('path');
const config = require('../../config/stellar');

class Transaction {
  static getDbPath() {
    return config.dbPath;
  }

  static ensureDbDir() {
    const dir = path.dirname(this.getDbPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static loadTransactions() {
    this.ensureDbDir();
    const dbPath = this.getDbPath();
    if (!fs.existsSync(dbPath)) {
      return [];
    }
    try {
      const data = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  static saveTransactions(transactions) {
    this.ensureDbDir();
    fs.writeFileSync(this.getDbPath(), JSON.stringify(transactions, null, 2));
  }

  static create(transactionData) {
    const transactions = this.loadTransactions();

    if (transactionData.idempotencyKey) {
      const existingTransaction = transactions.find(
        t => t.idempotencyKey === transactionData.idempotencyKey
      );

      if (existingTransaction) {
        return existingTransaction;
      }
    }

    const newTransaction = {
      id: Date.now().toString(),
      amount: transactionData.amount,
      donor: transactionData.donor,
      recipient: transactionData.recipient,
      timestamp: new Date().toISOString(),
      status: 'completed',
      stellarTxId: transactionData.stellarTxId || null,
      idempotencyKey: transactionData.idempotencyKey || null,
      ...transactionData
    };
    transactions.push(newTransaction);
    this.saveTransactions(transactions);
    return newTransaction;
  }

  static getPaginated({ limit = 10, offset = 0 } = {}) {
    const transactions = this.loadTransactions();

    const total = transactions.length;


    limit = parseInt(limit);
    offset = parseInt(offset);


    const paginatedData = transactions.slice(offset, offset + limit);

    return {
      data: paginatedData,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    };
  }

  static getById(id) {
    const transactions = this.loadTransactions();
    return transactions.find(t => t.id === id);
  }

  static getByDateRange(startDate, endDate) {
    const transactions = this.loadTransactions();
    return transactions.filter(t => {
      const txDate = new Date(t.timestamp);
      return txDate >= startDate && txDate <= endDate;
    });
  }

  static getAll() {
    return this.loadTransactions();
  }
}

module.exports = Transaction;
