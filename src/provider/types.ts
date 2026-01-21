// Provider Domain Types

export interface ProviderGame {
  id: string;
  game_id: string;
  name: string;
  is_active: boolean;
  min_bet: number;
  max_bet: number;
  created_at: Date;
}

export interface ProviderCasino {
  id: string;
  casino_code: string;
  casino_api_endpoint: string;
  secret_key: string;
  is_active: boolean;
  created_at: Date;
}

export interface ProviderCasinoUser {
  id: string;
  player_id: string;
  casino_code: string;
  external_user_id: string;
  created_at: Date;
}

export interface ProviderGameRound {
  id: string;
  round_id: string;
  player_id: string;
  game_id: string;
  session_id: string;
  currency: string;
  status: RoundStatus;
  total_bet_amount: number;
  total_payout_amount: number;
  created_at: Date;
  closed_at: Date | null;
}

export interface ProviderBet {
  id: string;
  transaction_id: string;
  round_id: string;
  bet_type: BetType;
  amount: number;
  status: BetStatus;
  casino_balance_after: number | null;
  response_cache: any;
  is_rolled_back: boolean;
  rollback_idempotency_marker: string | null;
  created_at: Date;
}

export type RoundStatus = 'open' | 'closed' | 'cancelled';
export type BetType = 'bet' | 'payout' | 'rollback';
export type BetStatus = 'pending' | 'confirmed' | 'failed' | 'rolled_back';

// API Request/Response Types

export interface ProviderLaunchRequest {
  casinoCode: string;
  playerId: string;
  gameId: string;
  sessionToken: string;
  currency: string;
  balance: number;
}

export interface ProviderLaunchResponse {
  success: boolean;
  providerSessionId: string;
  gameUrl: string;
  playerId: string;
}

export interface ProviderSimulateRequest {
  casinoCode: string;
  sessionToken: string;
  gameId: string;
  actions: SimulationAction[];
}

export interface SimulationAction {
  type: 'balance_check' | 'bet' | 'payout' | 'rollback';
  amount?: number;
  betIndex?: number; // for rollback, reference to which bet
}

export interface ProviderSimulateResponse {
  success: boolean;
  roundId: string;
  results: SimulationResult[];
  finalBalance: number;
}

export interface SimulationResult {
  action: string;
  transactionId?: string;
  amount?: number;
  balanceAfter?: number;
  success: boolean;
  error?: string;
}

// Provider Error Types

export class ProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const ProviderErrorCodes = {
  INVALID_CASINO: 'INVALID_CASINO',
  INVALID_GAME: 'INVALID_GAME',
  INVALID_SESSION: 'INVALID_SESSION',
  CASINO_API_ERROR: 'CASINO_API_ERROR',
  ROUND_NOT_FOUND: 'ROUND_NOT_FOUND',
  ROUND_CLOSED: 'ROUND_CLOSED',
  BET_NOT_FOUND: 'BET_NOT_FOUND',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
} as const;
