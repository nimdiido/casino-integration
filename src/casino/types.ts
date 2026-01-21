// Casino Domain Types

export interface CasinoUser {
  id: string;
  username: string;
  email: string;
  created_at: Date;
}

export interface CasinoWallet {
  id: string;
  user_id: string;
  currency_code: string;
  playable_balance: number;
  redeemable_balance: number;
  updated_at: Date;
}

export interface CasinoGameProvider {
  id: string;
  code: string;
  name: string;
  api_endpoint: string;
  secret_key: string;
  is_disabled: boolean;
  created_at: Date;
}

export interface CasinoGame {
  id: string;
  provider_id: string;
  provider_game_id: string;
  name: string;
  is_active: boolean;
  min_bet: number;
  max_bet: number;
  created_at: Date;
}

export interface CasinoGameSession {
  id: string;
  token: string;
  user_id: string;
  wallet_id: string;
  game_id: string;
  provider_session_id: string | null;
  is_active: boolean;
  created_at: Date;
  ended_at: Date | null;
}

export interface CasinoTransaction {
  id: string;
  wallet_id: string;
  session_id: string | null;
  transaction_type: TransactionType;
  amount: number;
  external_transaction_id: string;
  related_external_transaction_id: string | null;
  balance_after: number;
  response_cache: any;
  is_rollback: boolean;
  created_at: Date;
}

export type TransactionType = 'debit' | 'credit' | 'rollback';

// API Request/Response Types

export interface LaunchGameRequest {
  userId: string;
  gameId: string;
  currency?: string;
}

export interface LaunchGameResponse {
  success: boolean;
  sessionId: string;
  sessionToken: string;
  balance: number;
  currency: string;
  gameUrl?: string;
}

export interface GetBalanceRequest {
  sessionToken: string;
}

export interface GetBalanceResponse {
  success: boolean;
  balance: number;
  currency: string;
}

export interface DebitRequest {
  sessionToken: string;
  transactionId: string;
  roundId: string;
  amount: number;
  description?: string;
}

export interface DebitResponse {
  success: boolean;
  transactionId: string;
  balance: number;
  currency: string;
}

export interface CreditRequest {
  sessionToken: string;
  transactionId: string;
  roundId: string;
  amount: number;
  relatedTransactionId?: string;
  description?: string;
}

export interface CreditResponse {
  success: boolean;
  transactionId: string;
  balance: number;
  currency: string;
}

export interface RollbackRequest {
  sessionToken: string;
  transactionId: string;
  originalTransactionId: string;
  reason?: string;
}

export interface RollbackResponse {
  success: boolean;
  transactionId: string;
  rolledBack: boolean;
  balance: number;
  currency: string;
  message?: string;
}

export interface SimulateRoundRequest {
  userId: string;
  gameId: string;
  bets: {
    amount: number;
    type?: string;
  }[];
  wins: {
    amount: number;
    relatedBetIndex?: number;
  }[];
  rollbacks?: {
    betIndex: number;
  }[];
}

export interface SimulateRoundResponse {
  success: boolean;
  sessionId: string;
  roundId: string;
  transactions: {
    type: string;
    transactionId: string;
    amount: number;
    balanceAfter: number;
  }[];
  finalBalance: number;
  currency: string;
}

// Error Types

export class CasinoError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'CasinoError';
  }
}

export const ErrorCodes = {
  INVALID_SESSION: 'INVALID_SESSION',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  ROLLBACK_NOT_ALLOWED: 'ROLLBACK_NOT_ALLOWED',
  ALREADY_ROLLED_BACK: 'ALREADY_ROLLED_BACK',
  CANNOT_ROLLBACK_PAYOUT: 'CANNOT_ROLLBACK_PAYOUT',
} as const;
