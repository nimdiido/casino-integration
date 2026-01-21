-- =====================================================
-- CASINO & GAME PROVIDER INTEGRATION - DATABASE SCHEMA
-- =====================================================

-- ===================
-- CASINO DOMAIN (CASINO_*)
-- ===================

-- Player identity and account metadata
CREATE TABLE IF NOT EXISTS casino_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Authoritative balances per user and currency
CREATE TABLE IF NOT EXISTS casino_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES casino_users (id) ON DELETE CASCADE,
    currency_code VARCHAR(10) NOT NULL DEFAULT 'USD',
    playable_balance BIGINT NOT NULL DEFAULT 0,
    redeemable_balance BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, currency_code),
    CONSTRAINT positive_playable_balance CHECK (playable_balance >= 0),
    CONSTRAINT positive_redeemable_balance CHECK (redeemable_balance >= 0)
);

-- Provider registry and credentials
CREATE TABLE IF NOT EXISTS casino_game_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    api_endpoint VARCHAR(500) NOT NULL,
    secret_key VARCHAR(255) NOT NULL,
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Casino games mapped to provider games
CREATE TABLE IF NOT EXISTS casino_games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    provider_id UUID NOT NULL REFERENCES casino_game_providers (id) ON DELETE CASCADE,
    provider_game_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    min_bet BIGINT NOT NULL DEFAULT 100,
    max_bet BIGINT NOT NULL DEFAULT 100000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider_id, provider_game_id)
);

-- Session linking user, wallet, game, and provider session
CREATE TABLE IF NOT EXISTS casino_game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    token VARCHAR(500) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES casino_users (id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES casino_wallets (id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES casino_games (id) ON DELETE CASCADE,
    provider_session_id VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE
);

-- Ledger of bets, payouts, rollbacks and idempotency cache
CREATE TABLE IF NOT EXISTS casino_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id UUID NOT NULL REFERENCES casino_wallets (id) ON DELETE CASCADE,
    session_id UUID REFERENCES casino_game_sessions (id) ON DELETE SET NULL,
    transaction_type VARCHAR(50) NOT NULL,
    amount BIGINT NOT NULL,
    external_transaction_id VARCHAR(255) NOT NULL,
    related_external_transaction_id VARCHAR(255),
    balance_after BIGINT NOT NULL,
    response_cache JSONB,
    is_rollback BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (external_transaction_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_casino_transactions_external_id ON casino_transactions (external_transaction_id);

CREATE INDEX IF NOT EXISTS idx_casino_transactions_session ON casino_transactions (session_id);

CREATE INDEX IF NOT EXISTS idx_casino_transactions_wallet ON casino_transactions (wallet_id);

CREATE INDEX IF NOT EXISTS idx_casino_game_sessions_token ON casino_game_sessions (token);

CREATE INDEX IF NOT EXISTS idx_casino_game_sessions_user ON casino_game_sessions (user_id);

-- ===================
-- PROVIDER DOMAIN (PROVIDER_*)
-- ===================

-- Provider game catalog
CREATE TABLE IF NOT EXISTS provider_games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    game_id VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    min_bet BIGINT NOT NULL DEFAULT 100,
    max_bet BIGINT NOT NULL DEFAULT 100000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Mapping of casino partners
CREATE TABLE IF NOT EXISTS provider_casinos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    casino_code VARCHAR(50) NOT NULL UNIQUE,
    casino_api_endpoint VARCHAR(500) NOT NULL,
    secret_key VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Mapping of casino players to provider customers
CREATE TABLE IF NOT EXISTS provider_casino_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    player_id VARCHAR(255) NOT NULL,
    casino_code VARCHAR(50) NOT NULL,
    external_user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (casino_code, external_user_id)
);

-- Grouping of bets and payouts per round
CREATE TABLE IF NOT EXISTS provider_game_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    round_id VARCHAR(255) NOT NULL UNIQUE,
    player_id UUID NOT NULL REFERENCES provider_casino_users (id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES provider_games (id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    total_bet_amount BIGINT NOT NULL DEFAULT 0,
    total_payout_amount BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE
);

-- Each transaction attempt and casino response
CREATE TABLE IF NOT EXISTS provider_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    transaction_id VARCHAR(255) NOT NULL UNIQUE,
    round_id UUID NOT NULL REFERENCES provider_game_rounds (id) ON DELETE CASCADE,
    bet_type VARCHAR(50) NOT NULL,
    amount BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    casino_balance_after BIGINT,
    response_cache JSONB,
    is_rolled_back BOOLEAN NOT NULL DEFAULT FALSE,
    rollback_idempotency_marker VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_provider_bets_transaction ON provider_bets (transaction_id);

CREATE INDEX IF NOT EXISTS idx_provider_bets_round ON provider_bets (round_id);

CREATE INDEX IF NOT EXISTS idx_provider_game_rounds_round_id ON provider_game_rounds (round_id);

CREATE INDEX IF NOT EXISTS idx_provider_game_rounds_player ON provider_game_rounds (player_id);

CREATE INDEX IF NOT EXISTS idx_provider_casino_users_casino ON provider_casino_users (casino_code, external_user_id);