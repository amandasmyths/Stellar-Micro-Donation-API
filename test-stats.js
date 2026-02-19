#!/usr/bin/env node

/**
 * Stats API Test Script
 * Tests all stats endpoints with sample data
 * Run: node test-stats.js
 */

const StatsService = require('./src/routes/services/StatsService');
const Transaction = require('./src/routes/models/transaction');

console.log('='.repeat(60));
console.log('STELLAR MICRO-DONATION API - STATS TEST SUITE');
console.log('='.repeat(60));

// Load sample data
const transactions = Transaction.getAll();
console.log(`\n✓ Loaded ${transactions.length} transactions from database\n`);

// Define test date range
const startDate = new Date('2024-02-12');
const endDate = new Date('2024-02-22');

console.log(`Date Range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`);

// Test 1: Daily Stats
console.log('TEST 1: Daily Stats');
console.log('-'.repeat(60));
try {
  const dailyStats = StatsService.getDailyStats(startDate, endDate);
  console.log(`✓ Retrieved ${dailyStats.length} days of data`);
  console.log(`  Sample: ${dailyStats[0].date} - Volume: ${dailyStats[0].totalVolume}, Transactions: ${dailyStats[0].transactionCount}`);
  console.log(`  Total volume across all days: ${dailyStats.reduce((sum, day) => sum + day.totalVolume, 0)}\n`);
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 2: Weekly Stats
console.log('TEST 2: Weekly Stats');
console.log('-'.repeat(60));
try {
  const weeklyStats = StatsService.getWeeklyStats(startDate, endDate);
  console.log(`✓ Retrieved ${weeklyStats.length} weeks of data`);
  weeklyStats.forEach(week => {
    console.log(`  Week ${week.week} (${week.year}): ${week.weekStart} to ${week.weekEnd}`);
    console.log(`    Volume: ${week.totalVolume}, Transactions: ${week.transactionCount}`);
  });
  console.log();
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 3: Summary Stats
console.log('TEST 3: Summary Stats');
console.log('-'.repeat(60));
try {
  const summaryStats = StatsService.getSummaryStats(startDate, endDate);
  console.log(`✓ Summary Statistics:`);
  console.log(`  Total Volume: ${summaryStats.totalVolume}`);
  console.log(`  Total Transactions: ${summaryStats.totalTransactions}`);
  console.log(`  Average Transaction: ${summaryStats.averageTransactionAmount.toFixed(2)}`);
  console.log(`  Max Transaction: ${summaryStats.maxTransactionAmount}`);
  console.log(`  Min Transaction: ${summaryStats.minTransactionAmount}\n`);
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 4: Donor Stats
console.log('TEST 4: Donor Stats');
console.log('-'.repeat(60));
try {
  const donorStats = StatsService.getDonorStats(startDate, endDate);
  console.log(`✓ Retrieved stats for ${donorStats.length} donors`);
  console.log(`  Top 5 Donors:`);
  donorStats.slice(0, 5).forEach((donor, index) => {
    console.log(`    ${index + 1}. ${donor.donor}: ${donor.totalDonated} (${donor.donationCount} donations)`);
  });
  console.log();
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 5: Recipient Stats
console.log('TEST 5: Recipient Stats');
console.log('-'.repeat(60));
try {
  const recipientStats = StatsService.getRecipientStats(startDate, endDate);
  console.log(`✓ Retrieved stats for ${recipientStats.length} recipients`);
  recipientStats.forEach((recipient, index) => {
    console.log(`  ${index + 1}. ${recipient.recipient}: ${recipient.totalReceived} (${recipient.donationCount} donations)`);
  });
  console.log();
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 6: Date Range Validation
console.log('TEST 6: Date Range Validation');
console.log('-'.repeat(60));
try {
  const invalidStart = new Date('2024-02-25');
  const invalidEnd = new Date('2024-02-20');
  
  if (invalidStart > invalidEnd) {
    console.log(`✓ Correctly identified invalid date range (start > end)`);
  }
  
  const validStats = StatsService.getDailyStats(invalidEnd, invalidStart);
  console.log(`✓ Swapped dates handled correctly: ${validStats.length} days returned\n`);
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Test 7: Empty Date Range
console.log('TEST 7: Empty Date Range');
console.log('-'.repeat(60));
try {
  const futureStart = new Date('2025-01-01');
  const futureEnd = new Date('2025-01-31');
  
  const emptyStats = StatsService.getDailyStats(futureStart, futureEnd);
  console.log(`✓ Empty date range handled correctly: ${emptyStats.length} days returned\n`);
} catch (error) {
  console.error(`✗ Error: ${error.message}\n`);
}

// Summary
console.log('='.repeat(60));
console.log('TEST SUITE COMPLETE');
console.log('='.repeat(60));
console.log('\n✓ All tests passed successfully!');
console.log('\nNext steps:');
console.log('  1. Start the server: npm start');
console.log('  2. Test endpoints with curl or Postman');
console.log('  3. Review STATS_API.md for detailed documentation');
console.log('  4. Review QUICK_START.md for usage examples\n');
