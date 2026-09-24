/**
 * Wire protocol between the browser and the game server (JSON over a WebSocket at /ws),
 * plus the small REST API used to create games.
 */
import type { Deck, DeckInput } from './decks.ts';
import type { RoundStats } from './stats.ts';

export type Phase = 'voting' | 'revealing' | 'revealed';
export type Permission = 'everyone' | 'facilitators';

export interface GameSettings {
  /** Who can reveal cards, start a new round, run the timer and set the final result. */
  revealBy: Permission;
  /** Who can add, edit, delete and pick issues. */
  manageIssuesBy: Permission;
  /** Flip the cards automatically once every player has voted. */
  autoReveal: boolean;
  showAverage: boolean;
  /** 3-2-1 countdown before the cards flip. */
  countdown: boolean;
  /** Emoji throwing and confetti. */
  funFeatures: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  revealBy: 'everyone',
  manageIssuesBy: 'everyone',
  autoReveal: false,
  showAverage: true,
  countdown: true,
  funFeatures: true,
};

export interface PlayerView {
  id: string;
  name: string;
  spectator: boolean;
  online: boolean;
  facilitator: boolean;
  joinedAt: number;
  voted: boolean;
  /** Only ever sent for your own card, or for everyone once the cards are revealed. */
  vote: string | null;
}

export interface IssueView {
  id: string;
  title: string;
  link: string | null;
  estimate: string | null;
  createdAt: number;
}

export interface RevealedVote {
  playerId: string;
  name: string;
  value: string;
}

export interface RoundView {
  number: number;
  phase: Phase;
  startedAt: number;
  /** Server time at which the countdown ends and the cards flip. */
  revealAt: number | null;
  revealedAt: number | null;
  issueId: string | null;
  votes: RevealedVote[] | null;
  stats: RoundStats | null;
  /** Final result: the facilitator's pick if set, otherwise the suggested card. */
  result: string | null;
  resultOverridden: boolean;
}

export interface TimerView {
  durationMs: number;
  /** Set while running (server time). */
  endsAt: number | null;
  /** Set while paused. */
  remainingMs: number | null;
}

export interface Capabilities {
  reveal: boolean;
  manageIssues: boolean;
  manageGame: boolean;
  /** Promote/demote facilitators. Never granted by the "no facilitator online" fallback. */
  manageFacilitators: boolean;
  deleteGame: boolean;
}

export interface GameState {
  /** Server clock, used to sync countdowns and timers. */
  now: number;
  you: { id: string; can: Capabilities };
  game: {
    id: string;
    name: string;
    createdAt: number;
    deck: Deck;
    settings: GameSettings;
  };
  players: PlayerView[];
  round: RoundView;
  activeIssueId: string | null;
  timer: TimerView;
  historyCount: number;
  /** Changes whenever the voting history changes (new round, edited result, cleared). */
  historyVersion: number;
  issuesVersion: number;
}

export interface HistoryEntry {
  id: string;
  roundNumber: number;
  issueId: string | null;
  issueTitle: string | null;
  deckName: string;
  startedAt: number;
  revealedAt: number;
  result: string | null;
  stats: RoundStats;
  votes: Array<{ name: string; value: string }>;
}

export type TimerAction =
  | { action: 'start'; durationMs: number }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'reset' }
  | { action: 'add'; ms: number };

export type ClientMessage =
  | { type: 'join'; roomId: string; secret: string; name: string; spectator: boolean }
  | { type: 'vote'; value: string | null }
  | { type: 'reveal' }
  | { type: 'reset' }
  | { type: 'setResult'; value: string | null }
  | { type: 'profile'; name?: string; spectator?: boolean }
  | { type: 'settings'; name?: string; deck?: DeckInput; settings?: Partial<GameSettings> }
  | { type: 'facilitator'; playerId: string; value: boolean }
  | { type: 'kick'; playerId: string }
  | { type: 'leave' }
  | { type: 'issues:add'; issues: Array<{ title: string; link?: string | null }> }
  | { type: 'issues:update'; id: string; title?: string; link?: string | null; estimate?: string | null }
  | { type: 'issues:delete'; id: string }
  | { type: 'issues:clear' }
  | { type: 'issues:move'; id: string; toIndex: number }
  | { type: 'issues:vote'; id: string | null }
  | { type: 'issues:next' }
  | ({ type: 'timer' } & TimerAction)
  | { type: 'emoji'; to: string; emoji: string }
  | { type: 'history' }
  | { type: 'history:clear' }
  | { type: 'delete' };

export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'not_joined'
  | 'forbidden'
  | 'invalid_state'
  | 'game_full'
  | 'rate_limited'
  | 'server_busy';

export type ServerMessage =
  | { type: 'welcome'; you: string }
  | { type: 'state'; state: GameState }
  | { type: 'issues'; issues: IssueView[]; version: number }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'emoji'; id: string; from: string; to: string; emoji: string }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'kicked' }
  | { type: 'deleted' };

/** POST /api/games */
export interface CreateGameRequest {
  name: string;
  deck: DeckInput;
  settings?: Partial<GameSettings>;
  /** The creator's secret, so the server can make them the game's facilitator. */
  secret: string;
}

export interface CreateGameResponse {
  id: string;
}

/** GET /api/games/:id */
export interface GameInfoResponse {
  id: string;
  name: string;
}

export const ROOM_ID_LENGTH = 20;
export const ROOM_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
/** Per-browser secret: 22–64 url-safe characters. Never shown to other players. */
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/** Close codes used by the server (4000-4999 is the application range). */
export const CloseCode = {
  kicked: 4001,
  deleted: 4002,
  full: 4003,
  notFound: 4004,
  policy: 1008,
  restart: 1012,
} as const;
