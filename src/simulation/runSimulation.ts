import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.CASINO_API_URL?.replace('/casino', '') || 'http://localhost:3000';

interface SimulationConfig {
  userId: string;
  gameId: string;
  bets: { amount: number }[];
  wins: { amount: number; relatedBetIndex?: number }[];
  rollbacks?: { betIndex: number }[];
}

async function runSimulation() {
  console.log('='.repeat(70));
  console.log('🎮 CASINO & GAME PROVIDER INTEGRATION - FULL SIMULATION');
  console.log('='.repeat(70));
  console.log('');
  
  try {
    console.log('📡 Checking server health...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('   ✅ Server is healthy:', healthResponse.data.status);
    console.log('');
    
    // Simulation 1: Simple bet with win
    console.log('─'.repeat(70));
    console.log('📍 SIMULATION 1: Simple bet with win');
    console.log('─'.repeat(70));
    
    const sim1Config: SimulationConfig = {
      userId: '',
      gameId: '',
      bets: [{ amount: 1000 }], // $10 bet
      wins: [{ amount: 2500, relatedBetIndex: 0 }], // $25 win
      rollbacks: []
    };
    
    await runSingleSimulation(sim1Config, 'Bet $10.00, Win $25.00');
    
    // Simulation 2: Multiple bets with partial wins
    console.log('');
    console.log('─'.repeat(70));
    console.log('📍 SIMULATION 2: Multiple bets with partial wins');
    console.log('─'.repeat(70));
    
    const sim2Config: SimulationConfig = {
      userId: '',
      gameId: '',
      bets: [
        { amount: 500 },  // $5 bet
        { amount: 1000 }, // $10 bet
        { amount: 500 }   // $5 bet
      ],
      wins: [
        { amount: 1500, relatedBetIndex: 0 }, // $15 win from bet 1
        { amount: 0, relatedBetIndex: 1 }     // $0 win from bet 2 (lost)
      ],
      rollbacks: []
    };
    
    await runSingleSimulation(sim2Config, 'Multiple bets, partial wins');
    
    // Simulation 3: Bet with rollback
    console.log('');
    console.log('─'.repeat(70));
    console.log('📍 SIMULATION 3: Bet with rollback');
    console.log('─'.repeat(70));
    
    const sim3Config: SimulationConfig = {
      userId: '',
      gameId: '',
      bets: [
        { amount: 2000 }, // $20 bet - will be rolled back
        { amount: 1000 }  // $10 bet - will remain
      ],
      wins: [
        { amount: 3000, relatedBetIndex: 1 } // $30 win from bet 2
      ],
      rollbacks: [
        { betIndex: 0 } // Rollback the first bet
      ]
    };
    
    await runSingleSimulation(sim3Config, 'Bet with rollback');
    
    // Simulation 4: Idempotency test
    console.log('');
    console.log('─'.repeat(70));
    console.log('📍 SIMULATION 4: Idempotency test (same transaction twice)');
    console.log('─'.repeat(70));
    
    await testIdempotency();
    
    console.log('');
    console.log('='.repeat(70));
    console.log('✅ ALL SIMULATIONS COMPLETED SUCCESSFULLY');
    console.log('='.repeat(70));
    
  } catch (error: any) {
    console.error('❌ Simulation failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

async function runSingleSimulation(config: SimulationConfig, description: string) {
  console.log(`   📋 ${description}`);
  console.log('');
  
  const { userId, gameId } = await getTestData();
  config.userId = userId;
  config.gameId = gameId;
  
  // Run simulation via /casino/simulateRound
  const response = await axios.post(`${BASE_URL}/casino/simulateRound`, {
    userId: config.userId,
    gameId: config.gameId,
    bets: config.bets,
    wins: config.wins,
    rollbacks: config.rollbacks
  });
  
  const result = response.data;
  
  console.log(`   Session ID: ${result.sessionId}`);
  console.log(`   Round ID: ${result.roundId}`);
  console.log('');
  console.log('   Transactions:');
  
  for (const txn of result.transactions) {
    const amount = txn.amount ? `$${(txn.amount / 100).toFixed(2)}` : 'N/A';
    const balance = `$${(txn.balanceAfter / 100).toFixed(2)}`;
    console.log(`   - ${txn.type.toUpperCase()}: ${amount} → Balance: ${balance}`);
  }
  
  console.log('');
  console.log(`   💰 Final Balance: $${(result.finalBalance / 100).toFixed(2)}`);
}

async function testIdempotency() {
  console.log('   📋 Testing idempotency by sending duplicate debit request');
  console.log('');
  
  const { userId, gameId } = await getTestData();
  
  const launchResponse = await axios.post(`${BASE_URL}/casino/launchGame`, {
    userId,
    gameId
  });
  
  const sessionToken = launchResponse.data.sessionToken;
  const initialBalance = launchResponse.data.balance;
  const transactionId = `idempotency_test_${Date.now()}`;
  
  console.log(`   Session Token: ${sessionToken.substring(0, 20)}...`);
  console.log(`   Initial Balance: $${(initialBalance / 100).toFixed(2)}`);
  console.log(`   Transaction ID: ${transactionId}`);
  console.log('');
  
  const signBody = (body: any, secret: string) => {
    const crypto = require('crypto');
    return crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  };
  
  const debitPayload = {
    sessionToken,
    transactionId,
    roundId: 'test_round_1',
    amount: 500
  };
  
  const signature = signBody(debitPayload, process.env.PROVIDER_SECRET || 'provider_secret_key_change_in_production');
  
  const firstDebit = await axios.post(`${BASE_URL}/casino/debit`, debitPayload, {
    headers: { 'x-provider-signature': signature }
  });
  
  console.log('   First debit request:');
  console.log(`   - Balance after: $${(firstDebit.data.balance / 100).toFixed(2)}`);
  
  const secondDebit = await axios.post(`${BASE_URL}/casino/debit`, debitPayload, {
    headers: { 'x-provider-signature': signature }
  });
  
  console.log('');
  console.log('   Second debit request (duplicate):');
  console.log(`   - Balance after: $${(secondDebit.data.balance / 100).toFixed(2)}`);
  
  if (firstDebit.data.balance === secondDebit.data.balance) {
    console.log('');
    console.log('   ✅ Idempotency verified! Duplicate request returned same result.');
  } else {
    console.log('');
    console.log('   ❌ Idempotency FAILED! Balance differs between requests.');
  }
}

async function getTestData(): Promise<{ userId: string; gameId: string }> {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'casino_integration',
  });
  
  try {
    const userResult = await pool.query('SELECT id FROM casino_users LIMIT 1');
    const gameResult = await pool.query('SELECT id FROM casino_games LIMIT 1');
    
    if (!userResult.rows[0] || !gameResult.rows[0]) {
      throw new Error('No test data found. Run "npm run db:seed" first.');
    }
    
    return {
      userId: userResult.rows[0].id,
      gameId: gameResult.rows[0].id
    };
  } finally {
    await pool.end();
  }
}

runSimulation();
