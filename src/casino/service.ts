import { query, transaction } from '../database/connection';
import {
  CasinoUser,
  CasinoWallet,
  CasinoGame,
  CasinoGameSession,
  CasinoTransaction,
  CasinoGameProvider,
  CasinoError,
  ErrorCodes,
  TransactionType
} from './types';
import { generateSessionToken } from '../shared/security';
import { v4 as uuidv4 } from 'uuid';

export class CasinoService {
  
  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<CasinoUser | null> {
    const result = await query('SELECT * FROM casino_users WHERE id = $1', [userId]);
    return result.rows[0] || null;
  }
  
  /**
   * Get wallet by user ID and currency
   */
  async getWallet(userId: string, currency: string = 'USD'): Promise<CasinoWallet | null> {
    const result = await query(
      'SELECT * FROM casino_wallets WHERE user_id = $1 AND currency_code = $2',
      [userId, currency]
    );
    return result.rows[0] || null;
  }
  
  /**
   * Get wallet by ID
   */
  async getWalletById(walletId: string): Promise<CasinoWallet | null> {
    const result = await query('SELECT * FROM casino_wallets WHERE id = $1', [walletId]);
    return result.rows[0] || null;
  }
  
  /**
   * Get game by ID
   */
  async getGameById(gameId: string): Promise<CasinoGame | null> {
    const result = await query('SELECT * FROM casino_games WHERE id = $1', [gameId]);
    return result.rows[0] || null;
  }
  
  /**
   * Get game provider by ID
   */
  async getProviderById(providerId: string): Promise<CasinoGameProvider | null> {
    const result = await query('SELECT * FROM casino_game_providers WHERE id = $1', [providerId]);
    return result.rows[0] || null;
  }
  
  /**
   * Get session by token
   */
  async getSessionByToken(token: string): Promise<CasinoGameSession | null> {
    const result = await query(
      'SELECT * FROM casino_game_sessions WHERE token = $1 AND is_active = true',
      [token]
    );
    return result.rows[0] || null;
  }
  
  /**
   * Get session by ID
   */
  async getSessionById(sessionId: string): Promise<CasinoGameSession | null> {
    const result = await query('SELECT * FROM casino_game_sessions WHERE id = $1', [sessionId]);
    return result.rows[0] || null;
  }
  
  /**
   * Get transaction by external ID (for idempotency)
   */
  async getTransactionByExternalId(externalId: string): Promise<CasinoTransaction | null> {
    const result = await query(
      'SELECT * FROM casino_transactions WHERE external_transaction_id = $1',
      [externalId]
    );
    return result.rows[0] || null;
  }
  
  /**
   * Launch a game session
   */
  async launchGame(userId: string, gameId: string, currency: string = 'USD'): Promise<{
    session: CasinoGameSession;
    wallet: CasinoWallet;
    game: CasinoGame;
    provider: CasinoGameProvider;
  }> {
    // Validate user exists
    const user = await this.getUserById(userId);
    if (!user) {
      throw new CasinoError('User not found', ErrorCodes.USER_NOT_FOUND, 404);
    }
    
    // Validate game exists
    const game = await this.getGameById(gameId);
    if (!game || !game.is_active) {
      throw new CasinoError('Game not found or inactive', ErrorCodes.GAME_NOT_FOUND, 404);
    }
    
    // Get provider
    const provider = await this.getProviderById(game.provider_id);
    if (!provider || provider.is_disabled) {
      throw new CasinoError('Game provider not available', ErrorCodes.PROVIDER_NOT_FOUND, 404);
    }
    
    // Get or create wallet
    let wallet = await this.getWallet(userId, currency);
    if (!wallet) {
      // Create wallet with zero balance
      const walletId = uuidv4();
      await query(
        `INSERT INTO casino_wallets (id, user_id, currency_code, playable_balance, redeemable_balance)
         VALUES ($1, $2, $3, 0, 0)`,
        [walletId, userId, currency]
      );
      wallet = await this.getWalletById(walletId);
    }
    
    if (!wallet) {
      throw new CasinoError('Failed to get wallet', 'WALLET_ERROR', 500);
    }
    
    // Create game session
    const sessionId = uuidv4();
    const sessionToken = generateSessionToken();
    
    await query(
      `INSERT INTO casino_game_sessions (id, token, user_id, wallet_id, game_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, sessionToken, userId, wallet.id, gameId]
    );
    
    const session = await this.getSessionById(sessionId);
    if (!session) {
      throw new CasinoError('Failed to create session', 'SESSION_ERROR', 500);
    }
    
    return { session, wallet, game, provider };
  }
  
  /**
   * Get balance for a session
   */
  async getBalance(sessionToken: string): Promise<{
    balance: number;
    currency: string;
    session: CasinoGameSession;
  }> {
    const session = await this.getSessionByToken(sessionToken);
    if (!session) {
      throw new CasinoError('Invalid or expired session', ErrorCodes.INVALID_SESSION, 401);
    }
    
    const wallet = await this.getWalletById(session.wallet_id);
    if (!wallet) {
      throw new CasinoError('Wallet not found', 'WALLET_ERROR', 500);
    }
    
    return {
      balance: Number(wallet.playable_balance),
      currency: wallet.currency_code,
      session
    };
  }
  
  /**
   * Process a debit transaction (bet)
   * Implements idempotency and atomic balance updates
   */
  async processDebit(
    sessionToken: string,
    transactionId: string,
    roundId: string,
    amount: number
  ): Promise<{
    transaction: CasinoTransaction;
    balance: number;
    currency: string;
    isDuplicate: boolean;
  }> {
    // Check for duplicate transaction (idempotency)
    const existing = await this.getTransactionByExternalId(transactionId);
    if (existing) {
      const wallet = await this.getWalletById(existing.wallet_id);
      return {
        transaction: existing,
        balance: Number(wallet?.playable_balance || existing.balance_after),
        currency: wallet?.currency_code || 'USD',
        isDuplicate: true
      };
    }
    
    // Validate session
    const session = await this.getSessionByToken(sessionToken);
    if (!session) {
      throw new CasinoError('Invalid or expired session', ErrorCodes.INVALID_SESSION, 401);
    }
    
    // Validate amount
    if (amount <= 0) {
      throw new CasinoError('Amount must be positive', ErrorCodes.INVALID_AMOUNT, 400);
    }
    
    // Process atomically with transaction
    return await transaction(async (client) => {
      // Lock wallet row for update
      const walletResult = await client.query(
        'SELECT * FROM casino_wallets WHERE id = $1 FOR UPDATE',
        [session.wallet_id]
      );
      const wallet = walletResult.rows[0] as CasinoWallet;
      
      if (!wallet) {
        throw new CasinoError('Wallet not found', 'WALLET_ERROR', 500);
      }
      
      // Check sufficient funds
      if (Number(wallet.playable_balance) < amount) {
        throw new CasinoError(
          'Insufficient funds',
          ErrorCodes.INSUFFICIENT_FUNDS,
          400
        );
      }
      
      // Calculate new balance
      const newBalance = Number(wallet.playable_balance) - amount;
      
      // Update wallet balance
      await client.query(
        `UPDATE casino_wallets 
         SET playable_balance = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newBalance, wallet.id]
      );
      
      // Create transaction record
      const txnId = uuidv4();
      const responseCache = {
        success: true,
        transactionId,
        balance: newBalance,
        currency: wallet.currency_code
      };
      
      await client.query(
        `INSERT INTO casino_transactions 
         (id, wallet_id, session_id, transaction_type, amount, external_transaction_id, balance_after, response_cache)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [txnId, wallet.id, session.id, 'debit', amount, transactionId, newBalance, JSON.stringify(responseCache)]
      );
      
      const txnResult = await client.query(
        'SELECT * FROM casino_transactions WHERE id = $1',
        [txnId]
      );
      
      return {
        transaction: txnResult.rows[0],
        balance: newBalance,
        currency: wallet.currency_code,
        isDuplicate: false
      };
    });
  }
  
  /**
   * Process a credit transaction (win/payout)
   * Implements idempotency and atomic balance updates
   */
  async processCredit(
    sessionToken: string,
    transactionId: string,
    roundId: string,
    amount: number,
    relatedTransactionId?: string
  ): Promise<{
    transaction: CasinoTransaction;
    balance: number;
    currency: string;
    isDuplicate: boolean;
  }> {
    // Check for duplicate transaction (idempotency)
    const existing = await this.getTransactionByExternalId(transactionId);
    if (existing) {
      const wallet = await this.getWalletById(existing.wallet_id);
      return {
        transaction: existing,
        balance: Number(wallet?.playable_balance || existing.balance_after),
        currency: wallet?.currency_code || 'USD',
        isDuplicate: true
      };
    }
    
    // Validate session
    const session = await this.getSessionByToken(sessionToken);
    if (!session) {
      throw new CasinoError('Invalid or expired session', ErrorCodes.INVALID_SESSION, 401);
    }
    
    // Validate amount
    if (amount < 0) {
      throw new CasinoError('Amount cannot be negative', ErrorCodes.INVALID_AMOUNT, 400);
    }
    
    // Process atomically with transaction
    return await transaction(async (client) => {
      // Lock wallet row for update
      const walletResult = await client.query(
        'SELECT * FROM casino_wallets WHERE id = $1 FOR UPDATE',
        [session.wallet_id]
      );
      const wallet = walletResult.rows[0] as CasinoWallet;
      
      if (!wallet) {
        throw new CasinoError('Wallet not found', 'WALLET_ERROR', 500);
      }
      
      // Calculate new balance
      const newBalance = Number(wallet.playable_balance) + amount;
      
      // Update wallet balance
      await client.query(
        `UPDATE casino_wallets 
         SET playable_balance = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newBalance, wallet.id]
      );
      
      // Create transaction record
      const txnId = uuidv4();
      const responseCache = {
        success: true,
        transactionId,
        balance: newBalance,
        currency: wallet.currency_code
      };
      
      await client.query(
        `INSERT INTO casino_transactions 
         (id, wallet_id, session_id, transaction_type, amount, external_transaction_id, related_external_transaction_id, balance_after, response_cache)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [txnId, wallet.id, session.id, 'credit', amount, transactionId, relatedTransactionId || null, newBalance, JSON.stringify(responseCache)]
      );
      
      const txnResult = await client.query(
        'SELECT * FROM casino_transactions WHERE id = $1',
        [txnId]
      );
      
      return {
        transaction: txnResult.rows[0],
        balance: newBalance,
        currency: wallet.currency_code,
        isDuplicate: false
      };
    });
  }
  
  /**
   * Process a rollback transaction
   * Only bets can be rolled back, not payouts
   * Implements tombstone rule for idempotency
   */
  async processRollback(
    sessionToken: string,
    transactionId: string,
    originalTransactionId: string,
    reason?: string
  ): Promise<{
    transaction: CasinoTransaction | null;
    balance: number;
    currency: string;
    rolledBack: boolean;
    message: string;
  }> {
    // Check if rollback was already processed (idempotency with tombstone)
    const existingRollback = await this.getTransactionByExternalId(transactionId);
    if (existingRollback) {
      const wallet = await this.getWalletById(existingRollback.wallet_id);
      return {
        transaction: existingRollback,
        balance: Number(wallet?.playable_balance || existingRollback.balance_after),
        currency: wallet?.currency_code || 'USD',
        rolledBack: true,
        message: 'Rollback already processed (idempotent response)'
      };
    }
    
    // Find original transaction
    const originalTxn = await this.getTransactionByExternalId(originalTransactionId);
    
    // Tombstone rule: if original transaction not found, record rollback marker and return success
    if (!originalTxn) {
      // Validate session to get wallet info
      const session = await this.getSessionByToken(sessionToken);
      if (!session) {
        throw new CasinoError('Invalid or expired session', ErrorCodes.INVALID_SESSION, 401);
      }
      
      const wallet = await this.getWalletById(session.wallet_id);
      if (!wallet) {
        throw new CasinoError('Wallet not found', 'WALLET_ERROR', 500);
      }
      
      // Create tombstone record (rollback marker for non-existent transaction)
      const txnId = uuidv4();
      await query(
        `INSERT INTO casino_transactions 
         (id, wallet_id, session_id, transaction_type, amount, external_transaction_id, related_external_transaction_id, balance_after, is_rollback, response_cache)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [txnId, wallet.id, session.id, 'rollback', 0, transactionId, originalTransactionId, wallet.playable_balance, true, JSON.stringify({ tombstone: true, reason: 'Original transaction not found' })]
      );
      
      return {
        transaction: null,
        balance: Number(wallet.playable_balance),
        currency: wallet.currency_code,
        rolledBack: true,
        message: 'Tombstone recorded - original transaction not found, no balance change'
      };
    }
    
    // Check if original was already rolled back
    if (originalTxn.is_rollback) {
      const wallet = await this.getWalletById(originalTxn.wallet_id);
      return {
        transaction: null,
        balance: Number(wallet?.playable_balance || 0),
        currency: wallet?.currency_code || 'USD',
        rolledBack: false,
        message: 'Cannot rollback a rollback transaction'
      };
    }
    
    // Check if original transaction was already rolled back by another rollback
    const existingRollbackForOriginal = await query(
      'SELECT * FROM casino_transactions WHERE related_external_transaction_id = $1 AND transaction_type = $2',
      [originalTransactionId, 'rollback']
    );
    
    if (existingRollbackForOriginal.rows.length > 0) {
      const wallet = await this.getWalletById(originalTxn.wallet_id);
      
      // Create idempotency record
      const txnId = uuidv4();
      await query(
        `INSERT INTO casino_transactions 
         (id, wallet_id, session_id, transaction_type, amount, external_transaction_id, related_external_transaction_id, balance_after, is_rollback, response_cache)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [txnId, originalTxn.wallet_id, originalTxn.session_id, 'rollback', 0, transactionId, originalTransactionId, wallet?.playable_balance || 0, true, JSON.stringify({ alreadyRolledBack: true })]
      );
      
      return {
        transaction: null,
        balance: Number(wallet?.playable_balance || 0),
        currency: wallet?.currency_code || 'USD',
        rolledBack: true,
        message: 'Transaction was already rolled back'
      };
    }
    
    // Only bets (debits) can be rolled back, not payouts (credits)
    if (originalTxn.transaction_type === 'credit') {
      throw new CasinoError(
        'Payouts/credits cannot be rolled back',
        ErrorCodes.CANNOT_ROLLBACK_PAYOUT,
        400
      );
    }
    
    // Process rollback atomically
    return await transaction(async (client) => {
      // Lock wallet row
      const walletResult = await client.query(
        'SELECT * FROM casino_wallets WHERE id = $1 FOR UPDATE',
        [originalTxn.wallet_id]
      );
      const wallet = walletResult.rows[0] as CasinoWallet;
      
      if (!wallet) {
        throw new CasinoError('Wallet not found', 'WALLET_ERROR', 500);
      }
      
      // Reverse the debit (add amount back)
      const newBalance = Number(wallet.playable_balance) + Number(originalTxn.amount);
      
      // Update wallet
      await client.query(
        `UPDATE casino_wallets 
         SET playable_balance = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newBalance, wallet.id]
      );
      
      // Mark original as rolled back
      await client.query(
        'UPDATE casino_transactions SET is_rollback = true WHERE id = $1',
        [originalTxn.id]
      );
      
      // Create rollback transaction record
      const txnId = uuidv4();
      const responseCache = {
        success: true,
        transactionId,
        originalTransactionId,
        balance: newBalance,
        currency: wallet.currency_code,
        reason
      };
      
      await client.query(
        `INSERT INTO casino_transactions 
         (id, wallet_id, session_id, transaction_type, amount, external_transaction_id, related_external_transaction_id, balance_after, is_rollback, response_cache)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [txnId, wallet.id, originalTxn.session_id, 'rollback', originalTxn.amount, transactionId, originalTransactionId, newBalance, true, JSON.stringify(responseCache)]
      );
      
      const txnResult = await client.query(
        'SELECT * FROM casino_transactions WHERE id = $1',
        [txnId]
      );
      
      return {
        transaction: txnResult.rows[0],
        balance: newBalance,
        currency: wallet.currency_code,
        rolledBack: true,
        message: 'Transaction successfully rolled back'
      };
    });
  }
  
  /**
   * Update session with provider session ID
   */
  async updateSessionProviderSessionId(sessionId: string, providerSessionId: string): Promise<void> {
    await query(
      'UPDATE casino_game_sessions SET provider_session_id = $1 WHERE id = $2',
      [providerSessionId, sessionId]
    );
  }
  
  /**
   * End a game session
   */
  async endSession(sessionToken: string): Promise<void> {
    await query(
      `UPDATE casino_game_sessions 
       SET is_active = false, ended_at = CURRENT_TIMESTAMP 
       WHERE token = $1`,
      [sessionToken]
    );
  }
}

export const casinoService = new CasinoService();
