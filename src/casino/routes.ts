import { Router, Request, Response, NextFunction } from 'express';
import { casinoService } from './service';
import { verifyProviderSignature } from '../shared/middleware';
import { signBody } from '../shared/security';
import axios from 'axios';
import {
  LaunchGameRequest,
  LaunchGameResponse,
  GetBalanceRequest,
  GetBalanceResponse,
  DebitRequest,
  DebitResponse,
  CreditRequest,
  CreditResponse,
  RollbackRequest,
  RollbackResponse,
  SimulateRoundRequest,
  SimulateRoundResponse,
  CasinoError
} from './types';
import { generateTransactionId, generateRoundId } from '../shared/security';

const router = Router();

/**
 * POST /casino/launchGame
 * Initiated by frontend/client application
 * Validates the player and wallet, creates a casino-side game session,
 * and calls the Provider to initialize the corresponding provider-side session
 */
router.post('/launchGame', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, gameId, currency = 'USD' } = req.body as LaunchGameRequest;
    
    if (!userId || !gameId) {
      return res.status(400).json({
        success: false,
        error: 'userId and gameId are required'
      });
    }
    
    // Launch game session on Casino side
    const { session, wallet, game, provider } = await casinoService.launchGame(
      userId,
      gameId,
      currency
    );
    
    // Call Provider to initialize provider-side session
    const providerPayload = {
      casinoCode: 'CASINO_MAIN',
      playerId: userId,
      gameId: game.provider_game_id,
      sessionToken: session.token,
      currency: wallet.currency_code,
      balance: Number(wallet.playable_balance)
    };
    
    const signature = signBody(providerPayload, process.env.CASINO_SECRET || '');
    
    try {
      const providerResponse = await axios.post(
        `${provider.api_endpoint}/launch`,
        providerPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-casino-signature': signature
          },
          timeout: 10000
        }
      );
      
      if (providerResponse.data.success) {
        // Update session with provider session ID
        await casinoService.updateSessionProviderSessionId(
          session.id,
          providerResponse.data.providerSessionId
        );
      }
    } catch (providerError: any) {
      console.warn('Provider launch call failed:', providerError.message);
      // Continue even if provider call fails - session is still valid on casino side
    }
    
    const response: LaunchGameResponse = {
      success: true,
      sessionId: session.id,
      sessionToken: session.token,
      balance: Number(wallet.playable_balance),
      currency: wallet.currency_code
    };
    
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /casino/simulateRound
 * Test-driver endpoint that executes a launch flow and then calls
 * the Provider simulation endpoint
 * Used to demonstrate a complete end-to-end round
 */
router.post('/simulateRound', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, gameId, bets, wins, rollbacks } = req.body as SimulateRoundRequest;
    
    if (!userId || !gameId || !bets || bets.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'userId, gameId, and at least one bet are required'
      });
    }
    
    // First, launch the game
    const { session, wallet, game, provider } = await casinoService.launchGame(
      userId,
      gameId,
      'USD'
    );
    
    // Build simulation actions for provider
    const actions: any[] = [{ type: 'balance_check' }];
    
    // Add bets
    bets.forEach((bet, index) => {
      actions.push({
        type: 'bet',
        amount: bet.amount
      });
    });
    
    // Add wins/payouts
    if (wins && wins.length > 0) {
      wins.forEach((win) => {
        actions.push({
          type: 'payout',
          amount: win.amount,
          betIndex: win.relatedBetIndex
        });
      });
    }
    
    // Add rollbacks
    if (rollbacks && rollbacks.length > 0) {
      rollbacks.forEach((rb) => {
        actions.push({
          type: 'rollback',
          betIndex: rb.betIndex
        });
      });
    }
    
    // Call Provider simulate endpoint
    const providerPayload = {
      casinoCode: 'CASINO_MAIN',
      sessionToken: session.token,
      gameId: game.provider_game_id,
      actions
    };
    
    const signature = signBody(providerPayload, process.env.CASINO_SECRET || '');
    
    const providerResponse = await axios.post(
      `${provider.api_endpoint}/simulate`,
      providerPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-casino-signature': signature
        },
        timeout: 30000
      }
    );
    
    // Get final balance
    const { balance: finalBalance, currency } = await casinoService.getBalance(session.token);
    
    const response: SimulateRoundResponse = {
      success: true,
      sessionId: session.id,
      roundId: providerResponse.data.roundId,
      transactions: providerResponse.data.results
        .filter((r: any) => r.transactionId)
        .map((r: any) => ({
          type: r.action,
          transactionId: r.transactionId,
          amount: r.amount,
          balanceAfter: r.balanceAfter
        })),
      finalBalance,
      currency
    };
    
    res.json(response);
  } catch (error: any) {
    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data?.error || error.message,
        details: error.response.data
      });
    }
    next(error);
  }
});

/**
 * POST /casino/getBalance
 * Provider callback to retrieve the authoritative player balance
 * This endpoint must not mutate the state
 */
router.post('/getBalance', verifyProviderSignature, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionToken } = req.body as GetBalanceRequest;
    
    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        error: 'sessionToken is required'
      });
    }
    
    const { balance, currency } = await casinoService.getBalance(sessionToken);
    
    const response: GetBalanceResponse = {
      success: true,
      balance,
      currency
    };
    
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /casino/debit
 * Provider callback to deduct funds for a bet
 * Must validate available balance, apply the debit atomically, and be strictly idempotent
 */
router.post('/debit', verifyProviderSignature, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionToken, transactionId, roundId, amount, description } = req.body as DebitRequest;
    
    if (!sessionToken || !transactionId || !roundId || amount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'sessionToken, transactionId, roundId, and amount are required'
      });
    }
    
    const result = await casinoService.processDebit(
      sessionToken,
      transactionId,
      roundId,
      amount
    );
    
    const response: DebitResponse = {
      success: true,
      transactionId,
      balance: result.balance,
      currency: result.currency
    };
    
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /casino/credit
 * Provider callback to credit funds for a payout
 * Must be atomic, linked to the corresponding round/bet, and idempotent
 */
router.post('/credit', verifyProviderSignature, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionToken, transactionId, roundId, amount, relatedTransactionId, description } = req.body as CreditRequest;
    
    if (!sessionToken || !transactionId || !roundId || amount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'sessionToken, transactionId, roundId, and amount are required'
      });
    }
    
    const result = await casinoService.processCredit(
      sessionToken,
      transactionId,
      roundId,
      amount,
      relatedTransactionId
    );
    
    const response: CreditResponse = {
      success: true,
      transactionId,
      balance: result.balance,
      currency: result.currency
    };
    
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /casino/rollback
 * Provider callback to reverse a previously accepted bet
 * Must enforce rollback rules (bets only, no payouts, tombstones) and be idempotent
 */
router.post('/rollback', verifyProviderSignature, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionToken, transactionId, originalTransactionId, reason } = req.body as RollbackRequest;
    
    if (!sessionToken || !transactionId || !originalTransactionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionToken, transactionId, and originalTransactionId are required'
      });
    }
    
    const result = await casinoService.processRollback(
      sessionToken,
      transactionId,
      originalTransactionId,
      reason
    );
    
    const response: RollbackResponse = {
      success: true,
      transactionId,
      rolledBack: result.rolledBack,
      balance: result.balance,
      currency: result.currency,
      message: result.message
    };
    
    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
