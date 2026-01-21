import { pool } from './connection';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  console.log('🌱 Starting database seeding...');
  
  try {
    // Create test users
    const user1Id = uuidv4();
    const user2Id = uuidv4();
    
    await pool.query(`
      INSERT INTO casino_users (id, username, email)
      VALUES 
        ($1, 'player1', 'player1@example.com'),
        ($2, 'player2', 'player2@example.com')
      ON CONFLICT (username) DO NOTHING
    `, [user1Id, user2Id]);
    
    console.log('✅ Created test users');
    
    // Create wallets for users
    const wallet1Id = uuidv4();
    const wallet2Id = uuidv4();
    
    await pool.query(`
      INSERT INTO casino_wallets (id, user_id, currency_code, playable_balance, redeemable_balance)
      VALUES 
        ($1, $3, 'USD', 10000000, 5000000),
        ($2, $4, 'USD', 5000000, 2500000)
      ON CONFLICT (user_id, currency_code) DO UPDATE 
      SET playable_balance = EXCLUDED.playable_balance,
          redeemable_balance = EXCLUDED.redeemable_balance
    `, [wallet1Id, wallet2Id, user1Id, user2Id]);
    
    console.log('✅ Created wallets (100.00 USD and 50.00 USD in cents)');
    
    // Create game provider
    const providerId = uuidv4();
    
    await pool.query(`
      INSERT INTO casino_game_providers (id, code, name, api_endpoint, secret_key)
      VALUES ($1, 'JAQPOT', 'Jaqpot Games', 'http://localhost:3000/provider', $2)
      ON CONFLICT (code) DO UPDATE
      SET api_endpoint = EXCLUDED.api_endpoint,
          secret_key = EXCLUDED.secret_key
    `, [providerId, process.env.PROVIDER_SECRET || 'provider_secret_key_change_in_production']);
    
    console.log('✅ Created game provider (JAQPOT)');
    
    // Create casino games
    const game1Id = uuidv4();
    const game2Id = uuidv4();
    
    await pool.query(`
      INSERT INTO casino_games (id, provider_id, provider_game_id, name, min_bet, max_bet)
      VALUES 
        ($1, $3, 'slots-mega-fortune', 'Mega Fortune Slots', 100, 100000),
        ($2, $3, 'roulette-european', 'European Roulette', 500, 500000)
      ON CONFLICT (provider_id, provider_game_id) DO NOTHING
    `, [game1Id, game2Id, providerId]);
    
    console.log('✅ Created casino games');
        
    // Create provider games
    await pool.query(`
      INSERT INTO provider_games (game_id, name, min_bet, max_bet)
      VALUES 
        ('slots-mega-fortune', 'Mega Fortune Slots', 100, 100000),
        ('roulette-european', 'European Roulette', 500, 500000)
      ON CONFLICT (game_id) DO NOTHING
    `);
    
    console.log('✅ Created provider games');
    
    // Create provider casino partner
    await pool.query(`
      INSERT INTO provider_casinos (casino_code, casino_api_endpoint, secret_key)
      VALUES ('CASINO_MAIN', 'http://localhost:3000/casino', $1)
      ON CONFLICT (casino_code) DO UPDATE
      SET casino_api_endpoint = EXCLUDED.casino_api_endpoint,
          secret_key = EXCLUDED.secret_key
    `, [process.env.CASINO_SECRET || 'casino_secret_key_change_in_production']);
    
    console.log('✅ Created provider casino partner');
    
    console.log('\n🎉 Database seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   - 2 test users created');
    console.log('   - 2 wallets created (100.00 USD and 50.00 USD)');
    console.log('   - 1 game provider (JAQPOT)');
    console.log('   - 2 games (Mega Fortune Slots, European Roulette)');
    console.log('   - Provider domain initialized');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
