import express from 'express';
import dotenv from 'dotenv';
import casinoRoutes from './casino/routes';
import providerRoutes from './provider/routes';
import { errorHandler, requestLogger } from './shared/middleware';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(requestLogger);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      casino: 'active',
      provider: 'active'
    }
  });
});

app.use('/casino', casinoRoutes);

app.use('/provider', providerRoutes);

app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🎰 Casino & Game Provider Integration Server');
  console.log('='.repeat(60));
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('📍 Casino Platform Endpoints:');
  console.log(`   POST /casino/launchGame      - Launch a game session`);
  console.log(`   POST /casino/simulateRound   - Run a complete round simulation`);
  console.log(`   POST /casino/getBalance      - Get player balance (Provider callback)`);
  console.log(`   POST /casino/debit           - Debit for bet (Provider callback)`);
  console.log(`   POST /casino/credit          - Credit for payout (Provider callback)`);
  console.log(`   POST /casino/rollback        - Rollback a bet (Provider callback)`);
  console.log('');
  console.log('📍 Game Provider Endpoints:');
  console.log(`   POST /provider/launch        - Initialize provider session`);
  console.log(`   POST /provider/simulate      - Simulate a game round`);
  console.log(`   GET  /provider/health        - Health check`);
  console.log('');
  console.log('='.repeat(60));
});

export default app;
