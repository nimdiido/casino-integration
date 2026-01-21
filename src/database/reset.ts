import { pool } from './connection';

async function reset() {
  console.log('🗑️  Resetting database...');
  
  try {
    // Drop all tables in reverse order of dependencies
    await pool.query(`
      DROP TABLE IF EXISTS provider_bets CASCADE;
      DROP TABLE IF EXISTS provider_game_rounds CASCADE;
      DROP TABLE IF EXISTS provider_casino_users CASCADE;
      DROP TABLE IF EXISTS provider_casinos CASCADE;
      DROP TABLE IF EXISTS provider_games CASCADE;
      DROP TABLE IF EXISTS casino_transactions CASCADE;
      DROP TABLE IF EXISTS casino_game_sessions CASCADE;
      DROP TABLE IF EXISTS casino_games CASCADE;
      DROP TABLE IF EXISTS casino_game_providers CASCADE;
      DROP TABLE IF EXISTS casino_wallets CASCADE;
      DROP TABLE IF EXISTS casino_users CASCADE;
    `);
    
    console.log('✅ All tables dropped successfully!');
    console.log('💡 Run "npm run db:migrate" to recreate the schema');
    console.log('💡 Run "npm run db:seed" to add test data');
    
  } catch (error) {
    console.error('❌ Reset failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
