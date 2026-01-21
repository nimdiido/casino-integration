import { query, transaction } from "../database/connection";
import axios from "axios";
import {
  signBody,
  generateTransactionId,
  generateRoundId,
} from "../shared/security";
import {
  ProviderGame,
  ProviderCasino,
  ProviderCasinoUser,
  ProviderGameRound,
  ProviderBet,
  ProviderError,
  ProviderErrorCodes,
  BetType,
  BetStatus,
} from "./types";
import { v4 as uuidv4 } from "uuid";

export class ProviderService {
  // Get casino partner by code

  async getCasinoByCode(casinoCode: string): Promise<ProviderCasino | null> {
    const result = await query(
      "SELECT * FROM provider_casinos WHERE casino_code = $1 AND is_active = true",
      [casinoCode],
    );
    return result.rows[0] || null;
  }

  // Get game by ID

  async getGameByGameId(gameId: string): Promise<ProviderGame | null> {
    const result = await query(
      "SELECT * FROM provider_games WHERE game_id = $1 AND is_active = true",
      [gameId],
    );
    return result.rows[0] || null;
  }

  // Get or create casino user mapping
  async getOrCreateCasinoUser(
    casinoCode: string,
    externalUserId: string,
  ): Promise<ProviderCasinoUser> {
    // Check if user exists
    let result = await query(
      "SELECT * FROM provider_casino_users WHERE casino_code = $1 AND external_user_id = $2",
      [casinoCode, externalUserId],
    );

    if (result.rows[0]) {
      return result.rows[0];
    }

    // Create new user
    const playerId = uuidv4();
    await query(
      `INSERT INTO provider_casino_users (id, player_id, casino_code, external_user_id)
       VALUES ($1, $2, $3, $4)`,
      [playerId, `player_${externalUserId}`, casinoCode, externalUserId],
    );

    result = await query("SELECT * FROM provider_casino_users WHERE id = $1", [
      playerId,
    ]);
    return result.rows[0];
  }

  // Get round by ID

  async getRoundByRoundId(roundId: string): Promise<ProviderGameRound | null> {
    const result = await query(
      "SELECT * FROM provider_game_rounds WHERE round_id = $1",
      [roundId],
    );
    return result.rows[0] || null;
  }

  /**
   * Get bet by transaction ID
   */
  async getBetByTransactionId(
    transactionId: string,
  ): Promise<ProviderBet | null> {
    const result = await query(
      "SELECT * FROM provider_bets WHERE transaction_id = $1",
      [transactionId],
    );
    return result.rows[0] || null;
  }

  /**
   * Handle game launch from casino
   */
  async handleLaunch(
    casinoCode: string,
    playerId: string,
    gameId: string,
    sessionToken: string,
    currency: string,
    balance: number,
  ): Promise<{
    providerSessionId: string;
    gameUrl: string;
    playerId: string;
  }> {
    // Validate casino
    const casino = await this.getCasinoByCode(casinoCode);
    if (!casino) {
      throw new ProviderError(
        "Invalid casino",
        ProviderErrorCodes.INVALID_CASINO,
        401,
      );
    }

    // Validate game
    const game = await this.getGameByGameId(gameId);
    if (!game) {
      throw new ProviderError(
        "Game not found",
        ProviderErrorCodes.INVALID_GAME,
        404,
      );
    }

    // Get or create user
    const user = await this.getOrCreateCasinoUser(casinoCode, playerId);

    // Generate provider session ID
    const providerSessionId = `psess_${uuidv4()}`;

    return {
      providerSessionId,
      gameUrl: `/games/${gameId}?session=${providerSessionId}`,
      playerId: user.player_id,
    };
  }

  // Call Casino API with signature
  async callCasinoApi(
    casino: ProviderCasino,
    endpoint: string,
    payload: any,
  ): Promise<any> {
    const signature = signBody(payload, process.env.PROVIDER_SECRET || "");

    try {
      const response = await axios.post(
        `${casino.casino_api_endpoint}${endpoint}`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            "x-provider-signature": signature,
          },
          timeout: 10000,
        },
      );

      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new ProviderError(
          error.response.data?.error || "Casino API error",
          ProviderErrorCodes.CASINO_API_ERROR,
          error.response.status,
        );
      }
      throw error;
    }
  }

  // Simulate a full game round with bets, payouts, and optional rollbacks
  async simulateRound(
    casinoCode: string,
    sessionToken: string,
    gameId: string,
    actions: any[],
  ): Promise<{
    roundId: string;
    results: any[];
    finalBalance: number;
  }> {
    // Validate casino
    const casino = await this.getCasinoByCode(casinoCode);
    if (!casino) {
      throw new ProviderError(
        "Invalid casino",
        ProviderErrorCodes.INVALID_CASINO,
        401,
      );
    }

    // Validate game
    const game = await this.getGameByGameId(gameId);
    if (!game) {
      throw new ProviderError(
        "Game not found",
        ProviderErrorCodes.INVALID_GAME,
        404,
      );
    }

    // Generate round ID
    const roundId = generateRoundId();

    // Track results and bet transaction IDs for rollback references
    const results: any[] = [];
    const betTransactionIds: string[] = [];
    let currentBalance = 0;

    for (const action of actions) {
      try {
        switch (action.type) {
          case "balance_check": {
            const balanceResponse = await this.callCasinoApi(
              casino,
              "/getBalance",
              {
                sessionToken,
              },
            );

            currentBalance = balanceResponse.balance;
            results.push({
              action: "balance_check",
              balanceAfter: currentBalance,
              success: true,
            });
            break;
          }

          case "bet": {
            const transactionId = generateTransactionId("bet");

            const debitResponse = await this.callCasinoApi(casino, "/debit", {
              sessionToken,
              transactionId,
              roundId,
              amount: action.amount,
              description: "Game bet",
            });

            currentBalance = debitResponse.balance;
            betTransactionIds.push(transactionId);

            // Record bet in provider database
            await this.recordBet(
              roundId,
              transactionId,
              "bet",
              action.amount,
              "confirmed",
              currentBalance,
              debitResponse,
            );

            results.push({
              action: "bet",
              transactionId,
              amount: action.amount,
              balanceAfter: currentBalance,
              success: true,
            });
            break;
          }

          case "payout": {
            const transactionId = generateTransactionId("payout");
            const relatedTransactionId =
              action.betIndex !== undefined
                ? betTransactionIds[action.betIndex]
                : undefined;

            const creditResponse = await this.callCasinoApi(casino, "/credit", {
              sessionToken,
              transactionId,
              roundId,
              amount: action.amount,
              relatedTransactionId,
              description: "Game payout",
            });

            currentBalance = creditResponse.balance;

            // Record payout in provider database
            await this.recordBet(
              roundId,
              transactionId,
              "payout",
              action.amount,
              "confirmed",
              currentBalance,
              creditResponse,
            );

            results.push({
              action: "payout",
              transactionId,
              amount: action.amount,
              balanceAfter: currentBalance,
              success: true,
            });
            break;
          }

          case "rollback": {
            if (
              action.betIndex === undefined ||
              !betTransactionIds[action.betIndex]
            ) {
              results.push({
                action: "rollback",
                success: false,
                error: "Invalid bet index for rollback",
              });
              continue;
            }

            const originalTransactionId = betTransactionIds[action.betIndex];
            const transactionId = generateTransactionId("rollback");

            const rollbackResponse = await this.callCasinoApi(
              casino,
              "/rollback",
              {
                sessionToken,
                transactionId,
                originalTransactionId,
                reason: "Game cancelled",
              },
            );

            currentBalance = rollbackResponse.balance;

            // Record rollback in provider database
            await this.recordBet(
              roundId,
              transactionId,
              "rollback",
              0,
              "confirmed",
              currentBalance,
              rollbackResponse,
            );

            results.push({
              action: "rollback",
              transactionId,
              originalTransactionId,
              rolledBack: rollbackResponse.rolledBack,
              balanceAfter: currentBalance,
              success: true,
              message: rollbackResponse.message,
            });
            break;
          }

          default:
            results.push({
              action: action.type,
              success: false,
              error: "Unknown action type",
            });
        }
      } catch (error: any) {
        results.push({
          action: action.type,
          success: false,
          error: error.message || "Action failed",
        });

        // If a bet fails due to insufficient funds, continue with other actions
        if (error.code !== "INSUFFICIENT_FUNDS") {
          // For critical errors, you might want to stop the simulation
        }
      }
    }

    return {
      roundId,
      results,
      finalBalance: currentBalance,
    };
  }

  // Record a bet/payout/rollback in provider database
  private async recordBet(
    roundId: string,
    transactionId: string,
    betType: BetType,
    amount: number,
    status: BetStatus,
    balanceAfter: number,
    responseCache: any,
  ): Promise<void> {
    // First, ensure round exists (create if needed)
    let round = await this.getRoundByRoundId(roundId);

    if (!round) {
      // Create a placeholder round (in real implementation, you'd have proper user/game context)
      const roundDbId = uuidv4();

      // Get first casino user and game as placeholder
      const userResult = await query(
        "SELECT * FROM provider_casino_users LIMIT 1",
      );
      const gameResult = await query("SELECT * FROM provider_games LIMIT 1");

      if (userResult.rows[0] && gameResult.rows[0]) {
        await query(
          `INSERT INTO provider_game_rounds (id, round_id, player_id, game_id, session_id, currency, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            roundDbId,
            roundId,
            userResult.rows[0].id,
            gameResult.rows[0].id,
            "session",
            "USD",
            "open",
          ],
        );
        round = await this.getRoundByRoundId(roundId);
      }
    }

    if (!round) return;

    // Record the bet
    const betId = uuidv4();
    await query(
      `INSERT INTO provider_bets (id, transaction_id, round_id, bet_type, amount, status, casino_balance_after, response_cache)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        betId,
        transactionId,
        round.id,
        betType,
        amount,
        status,
        balanceAfter,
        JSON.stringify(responseCache),
      ],
    );

    // Update round totals
    if (betType === "bet") {
      await query(
        "UPDATE provider_game_rounds SET total_bet_amount = total_bet_amount + $1 WHERE id = $2",
        [amount, round.id],
      );
    } else if (betType === "payout") {
      await query(
        "UPDATE provider_game_rounds SET total_payout_amount = total_payout_amount + $1 WHERE id = $2",
        [amount, round.id],
      );
    }
  }
}

export const providerService = new ProviderService();
