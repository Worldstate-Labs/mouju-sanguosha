import * as legacy from "./game-v1";
import {
  applyGameActionV2,
  applyTimeoutV2,
  assertGameInvariantV2,
  createGameV2,
  getLegalActionsV2,
  type GameActionV2,
  type GameStateV2,
  type LegalActionV2,
} from "./game-v2";
import {
  STANDARD_DECK,
  kingdomName,
  roleName,
  type Card,
  type CardName,
  type Character,
  type Kingdom,
  type LobbySeat,
  type PlayerKind,
  type Role,
  type Suit,
} from "./game-v2-data";

export type GameState = legacy.GameState | GameStateV2;
export type GameAction = legacy.GameAction | GameActionV2;
export type LegalAction = legacy.LegalAction | LegalActionV2;

export function createGame(seats: LobbySeat[]): GameStateV2 {
  const cardIds = STANDARD_DECK.map(() => `c_${crypto.randomUUID().replaceAll("-", "")}`);
  return createGameV2(
    seats,
    { cardIds, rngMode: "system-v1" },
    { nowMs: Date.now() },
  );
}

export function applyGameAction(state: GameState, actorId: string, action: GameAction): GameState {
  if (state.engineVersion === 1) return legacy.applyGameAction(state, actorId, action as legacy.GameAction);
  return applyGameActionV2(state, actorId, action as GameActionV2, { nowMs: Date.now() });
}

export function applyTimeout(state: GameState): GameState {
  if (state.engineVersion === 1) return legacy.applyTimeout(state);
  return applyTimeoutV2(state, { nowMs: Date.now() });
}

export function getLegalActions(state: GameState, actorId: string): LegalAction[] {
  if (state.engineVersion === 1) return legacy.getLegalActions(state, actorId);
  return getLegalActionsV2(state, actorId);
}

export { kingdomName, roleName };
export { assertGameInvariantV2 };
export type { Card, CardName, Character, GameActionV2, GameStateV2, Kingdom, LegalActionV2, LobbySeat, PlayerKind, Role, Suit };
