# Casino & Game Provider Integration

## Backend Technical Test - Jaqpot Games

This project implements a real-world integration between an online casino platform and an external game provider, demonstrating bidirectional API communication, transactional integrity, idempotency, and secure communication between distributed services.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CASINO PLATFORM                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Game Session   │  │  Wallet Service │  │  Transaction Processor      │  │
│  │    Manager      │  │                 │  │  (Idempotent & Atomic)      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│                              │                                               │
│  Headers: x-casino-signature │ CASINO_SECRET                                │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │  Launch Game         │  Balance Check       │
        │  Debit / Credit      │  Rollback Request    │
        └──────────────────────┼──────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────────────┐
│  Headers: x-provider-signature │ PROVIDER_SECRET                            │
│                              │                                               │
│                        GAME PROVIDER                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   Game Engine   │  │  Round Manager  │  │      API Client             │  │
│  │                 │  │                 │  │  (Calls Casino APIs)        │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

- ✅ **Bidirectional API Communication** - Casino ↔ Provider with HMAC-SHA256 signatures
- ✅ **Idempotent Transactions** - All money-moving endpoints are idempotent
- ✅ **Atomic Balance Updates** - Database transactions with row-level locking
- ✅ **Rollback Support** - With tombstone rule for missing transactions
- ✅ **Complete Database Schema** - Casino and Provider domains separated
- ✅ **Full Simulation Endpoint** - End-to-end testing of game rounds

## Technical Stack

- **Runtime**: Node.js v18+
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Authentication**: HMAC-SHA256 signatures

## Quick Start

### Prerequisites

- Node.js v18 or higher
- PostgreSQL 14 or higher
- npm or yarn

### 1. Clone and Install

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your database credentials
```

### 3. Setup Database

```bash
# Create the database
psql -U postgres -c "CREATE DATABASE casino_integration;"

# Run migrations
npm run db:migrate

# Seed test data
npm run db:seed
```

### 4. Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### 5. Run Full Simulation

```bash
npm run simulate
```

## API Endpoints

### Casino Platform APIs

| Endpoint                | Method | Description                                 |
| ----------------------- | ------ | ------------------------------------------- |
| `/casino/launchGame`    | POST   | Launch a game session (Frontend initiated)  |
| `/casino/simulateRound` | POST   | Test-driver for complete round simulation   |
| `/casino/getBalance`    | POST   | Get player balance (Provider callback)      |
| `/casino/debit`         | POST   | Deduct funds for bet (Provider callback)    |
| `/casino/credit`        | POST   | Credit funds for payout (Provider callback) |
| `/casino/rollback`      | POST   | Rollback a bet (Provider callback)          |

### Game Provider APIs

| Endpoint             | Method | Description                        |
| -------------------- | ------ | ---------------------------------- |
| `/provider/launch`   | POST   | Initialize provider-side session   |
| `/provider/simulate` | POST   | Simulate a game round with actions |
| `/provider/health`   | GET    | Health check                       |

## Database Schema

### Casino Domain (CASINO\_\*)

- **casino_users** - Player identity and account metadata
- **casino_wallets** - Authoritative balances per user and currency
- **casino_game_providers** - Provider registry and credentials
- **casino_games** - Casino games mapped to provider games
- **casino_game_sessions** - Session linking user, wallet, game, and provider session
- **casino_transactions** - Ledger of bets, payouts, rollbacks and idempotency cache

### Provider Domain (PROVIDER\_\*)

- **provider_games** - Provider game catalog
- **provider_casinos** - Mapping of casino partners
- **provider_casino_users** - Mapping of casino players to provider customers
- **provider_game_rounds** - Grouping of bets and payouts per round
- **provider_bets** - Each transaction attempt and casino response

## Security

### HMAC-SHA256 Signatures

Each direction of communication uses its own dedicated secret and header:

| Direction         | Header                 | Secret            |
| ----------------- | ---------------------- | ----------------- |
| Provider → Casino | `x-casino-signature`   | `CASINO_SECRET`   |
| Casino → Provider | `x-provider-signature` | `PROVIDER_SECRET` |

### Signature Generation (Node.js)

```javascript
import crypto from "crypto";

function signBody(body, secret) {
  const payload = JSON.stringify(body);
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
```

### Signature Verification

Uses constant-time comparison to prevent timing attacks:

```javascript
function verifySignature(providedSig, body, secret) {
  const expectedSig = signBody(body, secret);
  const a = Buffer.from(providedSig, "hex");
  const b = Buffer.from(expectedSig, "hex");
  return crypto.timingSafeEqual(a, b);
}
```

## Idempotency

All provider-initiated money-moving endpoints (`/casino/debit`, `/casino/credit`, `/casino/rollback`) are idempotent:

- Each request includes a unique `transactionId` generated by the Provider
- The Casino stores the first successful result and returns it for duplicates
- Duplicate requests must not create additional balance movements
- The Provider may retry requests due to timeouts or network errors

## Rollback Rules

1. **Only bets can be rolled back** - Payouts/credits can never be rolled back
2. **No rollbacks for rounds with payouts** - Once a payout is issued, bets in that round cannot be reversed
3. **Tombstone Rule** - If original bet transaction cannot be found:
   - Record a rollback idempotency marker
   - Return success with no balance change
   - Provides auditability and prevents inconsistent retry behavior

## Usage Examples

### Launch a Game Session

```bash
curl -X POST http://localhost:3000/casino/launchGame \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid-here",
    "gameId": "game-uuid-here",
    "currency": "USD"
  }'
```

### Run a Complete Simulation

```bash
curl -X POST http://localhost:3000/casino/simulateRound \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid-here",
    "gameId": "game-uuid-here",
    "bets": [{"amount": 1000}, {"amount": 500}],
    "wins": [{"amount": 2500, "relatedBetIndex": 0}],
    "rollbacks": [{"betIndex": 1}]
  }'
```

## Project Structure

```
casino-integration/
├── src/
│   ├── casino/           # Casino Platform implementation
│   │   ├── routes.ts     # Express routes
│   │   ├── service.ts    # Business logic
│   │   └── types.ts      # TypeScript interfaces
│   ├── provider/         # Game Provider implementation
│   │   ├── routes.ts     # Express routes
│   │   ├── service.ts    # Business logic
│   │   └── types.ts      # TypeScript interfaces
│   ├── database/         # Database configuration
│   │   ├── connection.ts # PostgreSQL connection pool
│   │   ├── schema.sql    # Database schema
│   │   ├── migrate.ts    # Migration script
│   │   ├── seed.ts       # Seed data script
│   │   └── reset.ts      # Reset database script
│   ├── shared/           # Shared utilities
│   │   ├── security.ts   # HMAC signing/verification
│   │   └── middleware.ts # Express middleware
│   ├── simulation/       # Test simulation
│   │   └── runSimulation.ts
│   └── index.ts          # Application entry point
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Testing

```bash
# Run unit tests
npm test

# Run simulation (end-to-end)
npm run simulate
```

## Evaluation Criteria

- ✅ **Correctness and completeness** of the integration flow
- ✅ **Database design** and data integrity
- ✅ **Security implementation** (HMAC signatures)
- ✅ **Code quality** and structure
- ✅ **Clarity of documentation**

## License

ISC
