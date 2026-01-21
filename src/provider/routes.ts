import { Router, Request, Response, NextFunction } from 'express';
import { providerService } from './service';
import { verifyCasinoSignature } from '../shared/middleware';
import {
  ProviderLaunchRequest,
  ProviderLaunchResponse,
  ProviderSimulateRequest,
  ProviderSimulateResponse,
  ProviderError
} from './types';

const router = Router();

/**
 * POST /provider/launch
 * Called by the Casino during game launch
 * Creates a provider-side game session and returns data required to start gameplay
 */
router.post('/launch', verifyCasinoSignature, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      casinoCode,
      playerId,
      gameId,
      sessionToken,
      currency,
      balance
    } = req.body as ProviderLaunchRequest;
    
    if (!casinoCode || !playerId || !gameId || !sessionToken) {
      return res.status(400).json({
        success: false,
        error: 'casinoCode, playerId, gameId, and sessionToken are required'
      });
    }
    
    const result = await providerService.handleLaunch(
      casinoCode,
      playerId,
      gameId,
      sessionToken,
      currency || 'USD',
      balance || 0
    );
    
    const response: ProviderLaunchResponse = {
      success: true,
      providerSessionId: result.providerSessionId,
      gameUrl: result.gameUrl,
      playerId: result.playerId
    };
    
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /provider/simulate
 * Simulation endpoint called by the Casino (typically via /casino/simulateRound)
 * Confirms session/user identifiers and performs a scripted demo flow that includes:
 * at least one balance check, one or more bet debits, one or more payout credits,
 * and at least one rollback request
 */
router.post('/simulate', verifyCasinoSignature, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      casinoCode,
      sessionToken,
      gameId,
      actions
    } = req.body as ProviderSimulateRequest;
    
    if (!casinoCode || !sessionToken || !gameId || !actions || actions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'casinoCode, sessionToken, gameId, and actions are required'
      });
    }
    
    const result = await providerService.simulateRound(
      casinoCode,
      sessionToken,
      gameId,
      actions
    );
    
    const response: ProviderSimulateResponse = {
      success: true,
      roundId: result.roundId,
      results: result.results,
      finalBalance: result.finalBalance
    };
    
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /provider/health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'game-provider' });
});

export default router;
