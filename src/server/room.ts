/**
 * Game room: all game rules live here. The class is transport-agnostic (no sockets),
 * deterministic given its clock, and fully unit-tested.
 *
 * GDPR note: a room holds display names chosen by players, their votes and issue titles.
 * Nothing else is collected. Rooms live in memory (optionally snapshotted to disk) and are
 * purged after a period of inactivity; players are removed shortly after they disconnect.
 */
import { COFFEE, type Deck, resolveDeck, sameDeck } from '../shared/decks.ts';
import { LIMITS, THROWABLE_EMOJIS, cleanText, cleanUrl } from '../shared/limits.ts';
import {
  type Capabilities,
  DEFAULT_SETTINGS,
  type ErrorCode,
  type GameSettings,
  type GameState,
  type HistoryEntry,
  type IssueView,
  type Phase,
  type RevealedVote,
  type TimerAction,
} from '../shared/protocol.ts';
import { type RoundStats, computeStats } from '../shared/stats.ts';
import { randomId } from './ids.ts';

export class GameError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface RoomDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => { cancel: () => void };
  countdownMs: number;
  graceMs: number;
}

export type ChangeKind = 'state' | 'issues' | 'history';

interface PlayerRecord {
  id: string;
  name: string;
  spectator: boolean;
  joinedAt: number;
  lastSeenAt: number;
  /** Open sockets for this player (several tabs share one identity). Not persisted. */
  connections: number;
}

interface RoundRecord {
  number: number;
  phase: Phase;
  startedAt: number;
  revealAt: number | null;
  revealedAt: number | null;
  issueId: string | null;
  /** Hidden votes: only the voter themself sees their value before the reveal. */
  votes: Map<string, string>;
  revealed: { votes: RevealedVote[]; stats: RoundStats } | null;
  resultOverride: string | null;
  historyId: string | null;
}

interface TimerRecord {
  durationMs: number;
  endsAt: number | null;
  remainingMs: number | null;
}

export interface RoomSnapshot {
  id: string;
  name: string;
  createdAt: number;
  lastActiveAt: number;
  deck: Deck;
  settings: GameSettings;
  facilitators: string[];
  players: Array<Omit<PlayerRecord, 'connections'>>;
  round: Omit<RoundRecord, 'votes'> & { votes: Array<[string, string]> };
  issues: IssueView[];
  activeIssueId: string | null;
  history: HistoryEntry[];
  timer: TimerRecord;
}

type Action = 'reveal' | 'manageIssues' | 'manageGame' | 'manageFacilitators' | 'deleteGame';

const EMOJI_BURST = 6;
const EMOJI_REFILL_PER_MS = 2 / 1000;

export class Room {
  readonly id: string;
  name: string;
  readonly createdAt: number;
  lastActiveAt: number;
  deck: Deck;
  settings: GameSettings;
  readonly facilitators = new Set<string>();
  readonly players = new Map<string, PlayerRecord>();
  round: RoundRecord;
  issues: IssueView[] = [];
  activeIssueId: string | null = null;
  history: HistoryEntry[] = [];
  timer: TimerRecord = { durationMs: 0, endsAt: null, remainingMs: null };
  issuesVersion = 1;
  historyVersion = 1;
  onChange: ((kind: ChangeKind) => void) | null = null;

  private readonly deps: RoomDeps;
  private revealTimer: { cancel: () => void } | null = null;
  private readonly emojiBudget = new Map<string, { tokens: number; at: number }>();

  constructor(init: { id: string; name: string; deck: Deck; settings: GameSettings; createdAt?: number }, deps: RoomDeps) {
    this.deps = deps;
    const now = deps.now();
    this.id = init.id;
    this.name = init.name;
    this.deck = init.deck;
    this.settings = { ...init.settings };
    this.createdAt = init.createdAt ?? now;
    this.lastActiveAt = now;
    this.round = this.freshRound(1, null);
  }

  // ---------------------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------------------

  isFacilitator(playerId: string): boolean {
    return this.facilitators.has(playerId);
  }

  /** A facilitator is seated: connected, or disconnected but still inside the grace period. */
  private facilitatorPresent(): boolean {
    for (const id of this.facilitators) if (this.players.has(id)) return true;
    return false;
  }

  /**
   * Facilitators can do everything. Others follow the game settings. When no facilitator is at
   * the table, everyone may run the game (reveal, issues, settings) so a team is never locked
   * out of its own room. Granting facilitator rights and deleting the game are never part of
   * that fallback: they stay with the facilitators unless the game has none at all.
   */
  can(playerId: string, action: Action): boolean {
    if (this.facilitators.has(playerId)) return true;
    if (action === 'deleteGame' || action === 'manageFacilitators') return this.facilitators.size === 0;
    if (!this.facilitatorPresent()) return true;
    if (action === 'reveal') return this.settings.revealBy === 'everyone';
    if (action === 'manageIssues') return this.settings.manageIssuesBy === 'everyone';
    return false;
  }

  private require(playerId: string, action: Action): void {
    if (this.can(playerId, action)) return;
    const what: Record<Action, string> = {
      reveal: 'Only facilitators can control the voting in this game.',
      manageIssues: 'Only facilitators can manage issues in this game.',
      manageGame: 'Only facilitators can change this game.',
      manageFacilitators: 'Only facilitators can choose who is a facilitator.',
      deleteGame: 'Only facilitators can delete this game.',
    };
    throw new GameError('forbidden', what[action]);
  }

  private requirePlayer(playerId: string): PlayerRecord {
    const player = this.players.get(playerId);
    if (!player) throw new GameError('not_joined', 'Join the game first.');
    return player;
  }

  // ---------------------------------------------------------------------------------------
  // Presence
  // ---------------------------------------------------------------------------------------

  /** A socket for `playerId` joined. Creates the player on first join. */
  attach(playerId: string, profile: { name: string; spectator: boolean }): void {
    const name = cleanText(profile.name, LIMITS.playerName);
    if (!name) throw new GameError('bad_request', `Your name must be 1–${LIMITS.playerName} characters long.`);
    const now = this.deps.now();
    let player = this.players.get(playerId);
    if (!player) {
      if (this.players.size >= LIMITS.playersPerGame) {
        throw new GameError('game_full', `This game is full (${LIMITS.playersPerGame} players).`);
      }
      player = { id: playerId, name, spectator: profile.spectator, joinedAt: now, lastSeenAt: now, connections: 0 };
      this.players.set(playerId, player);
    } else {
      player.name = name;
      this.applySpectator(player, profile.spectator);
    }
    player.connections++;
    player.lastSeenAt = now;
    this.changed();
  }

  detach(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connections = Math.max(0, player.connections - 1);
    player.lastSeenAt = this.deps.now();
    this.changed();
  }

  /** Explicit "Leave game": the seat is freed immediately. */
  leave(playerId: string): void {
    if (this.removePlayer(playerId)) this.changed();
    this.maybeAutoReveal();
  }

  connectionCount(): number {
    let total = 0;
    for (const player of this.players.values()) total += player.connections;
    return total;
  }

  hasPendingDisconnects(): boolean {
    for (const player of this.players.values()) if (player.connections === 0) return true;
    return false;
  }

  /** Removes players that have been disconnected for longer than the grace period. */
  sweep(): number {
    const now = this.deps.now();
    let removed = 0;
    for (const player of [...this.players.values()]) {
      if (player.connections === 0 && now - player.lastSeenAt >= this.deps.graceMs) {
        this.removePlayer(player.id);
        removed++;
      }
    }
    if (removed) {
      this.changed();
      this.maybeAutoReveal();
    }
    return removed;
  }

  private removePlayer(playerId: string): boolean {
    if (!this.players.delete(playerId)) return false;
    this.emojiBudget.delete(playerId);
    if (this.round.phase !== 'revealed') this.round.votes.delete(playerId);
    return true;
  }

  // ---------------------------------------------------------------------------------------
  // Voting
  // ---------------------------------------------------------------------------------------

  vote(playerId: string, value: string | null): void {
    const player = this.requirePlayer(playerId);
    if (player.spectator) throw new GameError('invalid_state', 'Spectators cannot vote.');
    if (this.round.phase === 'revealed') throw new GameError('invalid_state', 'The cards are already revealed.');
    if (value === null) {
      if (!this.round.votes.delete(playerId)) return;
    } else {
      if (!this.deck.cards.includes(value)) throw new GameError('bad_request', 'That card is not in this deck.');
      if (this.round.votes.get(playerId) === value) return;
      this.round.votes.set(playerId, value);
    }
    this.changed();
    this.maybeAutoReveal();
  }

  reveal(actorId: string): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'reveal');
    if (this.round.phase !== 'voting') throw new GameError('invalid_state', 'The cards are already being revealed.');
    if (this.round.votes.size === 0) throw new GameError('invalid_state', 'Nobody has voted yet.');
    this.startReveal();
  }

  private maybeAutoReveal(): void {
    if (!this.settings.autoReveal || this.round.phase !== 'voting') return;
    const voters = [...this.players.values()].filter((p) => !p.spectator);
    if (voters.length > 0 && voters.every((p) => this.round.votes.has(p.id))) this.startReveal();
  }

  private startReveal(): void {
    if (!this.settings.countdown || this.deps.countdownMs <= 0) {
      this.finishReveal();
      return;
    }
    const round = this.round;
    round.phase = 'revealing';
    round.revealAt = this.deps.now() + this.deps.countdownMs;
    this.scheduleReveal(this.deps.countdownMs);
    this.changed();
  }

  private scheduleReveal(ms: number): void {
    this.revealTimer?.cancel();
    const roundNumber = this.round.number;
    this.revealTimer = this.deps.setTimer(() => {
      this.revealTimer = null;
      if (this.round.number === roundNumber && this.round.phase === 'revealing') this.finishReveal();
    }, ms);
  }

  private finishReveal(): void {
    this.revealTimer?.cancel();
    this.revealTimer = null;
    const round = this.round;
    const now = this.deps.now();
    const votes: RevealedVote[] = [];
    for (const player of [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)) {
      const value = round.votes.get(player.id);
      if (value !== undefined && !player.spectator) votes.push({ playerId: player.id, name: player.name, value });
    }
    if (votes.length === 0) {
      // Everyone withdrew their vote during the countdown.
      round.phase = 'voting';
      round.revealAt = null;
      this.changed();
      return;
    }
    const stats = computeStats(votes, this.deck.cards);
    round.phase = 'revealed';
    round.revealAt = null;
    round.revealedAt = now;
    round.revealed = { votes, stats };
    round.resultOverride = null;

    const issue = round.issueId ? this.issues.find((i) => i.id === round.issueId) : undefined;
    const entry: HistoryEntry = {
      id: randomId(10),
      roundNumber: round.number,
      issueId: issue?.id ?? null,
      issueTitle: issue?.title ?? null,
      deckName: this.deck.name,
      startedAt: round.startedAt,
      revealedAt: now,
      result: stats.suggested,
      stats,
      votes: votes.map(({ name, value }) => ({ name, value })),
    };
    round.historyId = entry.id;
    this.history.push(entry);
    if (this.history.length > LIMITS.historyEntries) this.history.splice(0, this.history.length - LIMITS.historyEntries);
    if (issue && stats.suggested !== null) this.setIssueEstimate(issue, stats.suggested);
    this.changed('history');
  }

  /** "Vote again": a fresh round for the same issue. */
  reset(actorId: string): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'reveal');
    this.startRound(this.round.issueId);
  }

  /** The facilitator's final pick after discussion. `null` goes back to the suggestion. */
  setResult(actorId: string, value: string | null): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'reveal');
    const round = this.round;
    if (round.phase !== 'revealed' || !round.revealed) throw new GameError('invalid_state', 'Reveal the cards first.');
    if (value !== null && (!this.deck.cards.includes(value) || value === COFFEE)) {
      throw new GameError('bad_request', 'Pick a card from the deck.');
    }
    round.resultOverride = value;
    const result = value ?? round.revealed.stats.suggested;
    const entry = this.history.find((h) => h.id === round.historyId);
    if (entry) entry.result = result;
    const issue = round.issueId ? this.issues.find((i) => i.id === round.issueId) : undefined;
    if (issue && result !== null) this.setIssueEstimate(issue, result);
    this.changed('history');
  }

  private startRound(issueId: string | null): void {
    this.revealTimer?.cancel();
    this.revealTimer = null;
    this.round = this.freshRound(this.round.number + 1, issueId);
    this.changed();
  }

  private freshRound(number: number, issueId: string | null): RoundRecord {
    return {
      number,
      phase: 'voting',
      startedAt: this.deps.now(),
      revealAt: null,
      revealedAt: null,
      issueId,
      votes: new Map(),
      revealed: null,
      resultOverride: null,
      historyId: null,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Players & game settings
  // ---------------------------------------------------------------------------------------

  updateProfile(playerId: string, patch: { name?: unknown; spectator?: unknown }): void {
    const player = this.requirePlayer(playerId);
    if (patch.name !== undefined) {
      const name = cleanText(patch.name, LIMITS.playerName);
      if (!name) throw new GameError('bad_request', `Your name must be 1–${LIMITS.playerName} characters long.`);
      player.name = name;
    }
    if (patch.spectator !== undefined) {
      if (typeof patch.spectator !== 'boolean') throw new GameError('bad_request', 'Invalid spectator flag.');
      this.applySpectator(player, patch.spectator);
    }
    this.changed();
    this.maybeAutoReveal();
  }

  private applySpectator(player: PlayerRecord, spectator: boolean): void {
    if (player.spectator === spectator) return;
    player.spectator = spectator;
    if (spectator && this.round.phase !== 'revealed') this.round.votes.delete(player.id);
  }

  updateSettings(actorId: string, patch: { name?: unknown; deck?: unknown; settings?: unknown }): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageGame');
    let name = this.name;
    let deck = this.deck;
    let settings = this.settings;
    if (patch.name !== undefined) {
      const cleaned = cleanText(patch.name, LIMITS.gameName);
      if (!cleaned) throw new GameError('bad_request', `The game name must be 1–${LIMITS.gameName} characters long.`);
      name = cleaned;
    }
    if (patch.deck !== undefined) {
      const resolved = resolveDeck(patch.deck);
      if (!resolved.ok) throw new GameError('bad_request', resolved.message);
      deck = resolved.deck;
    }
    if (patch.settings !== undefined) settings = mergeSettings(settings, patch.settings);

    const deckChanged = !sameDeck(deck, this.deck);
    const autoRevealEnabled = settings.autoReveal && !this.settings.autoReveal;
    this.name = name;
    this.deck = deck;
    this.settings = settings;
    // Votes from another deck are meaningless: start over.
    if (deckChanged) this.startRound(this.round.issueId);
    this.changed();
    if (autoRevealEnabled) this.maybeAutoReveal();
  }

  setFacilitator(actorId: string, targetId: string, value: boolean): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageFacilitators');
    if (value) {
      if (!this.players.has(targetId)) throw new GameError('not_found', 'That player is not in the game.');
      this.facilitators.add(targetId);
    } else {
      this.facilitators.delete(targetId);
    }
    this.changed();
  }

  /** Removes another player from the table. They may rejoin with the link. */
  kick(actorId: string, targetId: string): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageGame');
    if (actorId === targetId) throw new GameError('bad_request', 'Use "Leave game" to leave.');
    if (!this.removePlayer(targetId)) throw new GameError('not_found', 'That player is not in the game.');
    // A removed player must not keep facilitator rights when they rejoin with the link.
    this.facilitators.delete(targetId);
    this.changed();
    this.maybeAutoReveal();
  }

  // ---------------------------------------------------------------------------------------
  // Issues
  // ---------------------------------------------------------------------------------------

  addIssues(actorId: string, items: unknown): IssueView[] {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageIssues');
    if (!Array.isArray(items) || items.length === 0 || items.length > LIMITS.issuesPerMessage) {
      throw new GameError('bad_request', `Add between 1 and ${LIMITS.issuesPerMessage} issues at a time.`);
    }
    if (this.issues.length + items.length > LIMITS.issuesPerGame) {
      throw new GameError('bad_request', `A game can hold at most ${LIMITS.issuesPerGame} issues.`);
    }
    const added: IssueView[] = [];
    for (const item of items as Array<{ title?: unknown; link?: unknown }>) {
      const title = cleanText(item?.title, LIMITS.issueTitle);
      if (!title) continue;
      const link = parseLink(item?.link);
      added.push({ id: randomId(10), title, link, estimate: null, createdAt: this.deps.now() });
    }
    if (added.length === 0) {
      throw new GameError('bad_request', `Issue titles must be 1–${LIMITS.issueTitle} characters long.`);
    }
    this.issues.push(...added);
    this.changed('issues');
    return added;
  }

  updateIssue(actorId: string, id: string, patch: { title?: unknown; link?: unknown; estimate?: unknown }): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageIssues');
    const issue = this.findIssue(id);
    // Validate every field before changing anything, so a bad link never leaves a half-applied edit.
    let { title, link, estimate } = issue;
    if (patch.title !== undefined) {
      const cleaned = cleanText(patch.title, LIMITS.issueTitle);
      if (!cleaned) throw new GameError('bad_request', `Issue titles must be 1–${LIMITS.issueTitle} characters long.`);
      title = cleaned;
    }
    if (patch.link !== undefined) link = parseLink(patch.link);
    if (patch.estimate !== undefined) {
      const value = patch.estimate;
      if (value !== null && (typeof value !== 'string' || !this.deck.cards.includes(value) || value === COFFEE)) {
        throw new GameError('bad_request', 'Pick a card from the deck.');
      }
      estimate = value;
    }
    Object.assign(issue, { title, link, estimate });
    this.changed('issues');
  }

  deleteIssue(actorId: string, id: string): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageIssues');
    const issue = this.findIssue(id);
    this.issues = this.issues.filter((i) => i !== issue);
    if (this.activeIssueId === id) this.activeIssueId = null;
    if (this.round.issueId === id) this.round.issueId = null;
    this.changed('issues');
  }

  clearIssues(actorId: string): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageIssues');
    this.issues = [];
    this.activeIssueId = null;
    this.round.issueId = null;
    this.changed('issues');
  }

  moveIssue(actorId: string, id: string, toIndex: unknown): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageIssues');
    const issue = this.findIssue(id);
    if (typeof toIndex !== 'number' || !Number.isInteger(toIndex)) throw new GameError('bad_request', 'Invalid position.');
    const rest = this.issues.filter((i) => i !== issue);
    const index = Math.max(0, Math.min(rest.length, toIndex));
    rest.splice(index, 0, issue);
    this.issues = rest;
    this.changed('issues');
  }

  /** Starts a new round on the given issue (or without an issue when `id` is null). */
  voteIssue(actorId: string, id: string | null): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageIssues');
    if (id !== null) this.findIssue(id);
    this.activeIssueId = id;
    this.startRound(id);
  }

  /** Moves on to the next issue without an estimate. */
  nextIssue(actorId: string): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageIssues');
    const next = this.nextIssueCandidate();
    if (!next) throw new GameError('invalid_state', 'There are no more issues to estimate.');
    this.voteIssue(actorId, next.id);
  }

  nextIssueCandidate(): IssueView | null {
    const currentIndex = this.issues.findIndex((i) => i.id === this.activeIssueId);
    const ordered = [...this.issues.slice(currentIndex + 1), ...this.issues.slice(0, Math.max(0, currentIndex))];
    return ordered.find((i) => i.estimate === null && i.id !== this.activeIssueId) ?? null;
  }

  private findIssue(id: string): IssueView {
    const issue = this.issues.find((i) => i.id === id);
    if (!issue) throw new GameError('not_found', 'That issue no longer exists.');
    return issue;
  }

  private setIssueEstimate(issue: IssueView, estimate: string): void {
    if (issue.estimate === estimate) return;
    issue.estimate = estimate;
    this.changed('issues');
  }

  // ---------------------------------------------------------------------------------------
  // Timer, emojis, history
  // ---------------------------------------------------------------------------------------

  timerAction(actorId: string, command: TimerAction): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'reveal');
    const now = this.deps.now();
    const timer = this.timer;
    const validMs = (ms: unknown): number => {
      if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 1000 || ms > LIMITS.timerMaxMs) {
        throw new GameError('bad_request', 'Invalid timer duration.');
      }
      return ms;
    };
    switch (command.action) {
      case 'start': {
        const durationMs = validMs(command.durationMs);
        this.timer = { durationMs, endsAt: now + durationMs, remainingMs: null };
        break;
      }
      case 'pause':
        if (timer.endsAt === null) return;
        this.timer = { ...timer, endsAt: null, remainingMs: Math.max(0, timer.endsAt - now) };
        break;
      case 'resume':
        if (timer.remainingMs === null) return;
        this.timer = { ...timer, endsAt: now + timer.remainingMs, remainingMs: null };
        break;
      case 'add': {
        const ms = validMs(command.ms);
        if (timer.endsAt !== null) {
          const endsAt = Math.min(Math.max(timer.endsAt, now) + ms, now + LIMITS.timerMaxMs);
          this.timer = { ...timer, durationMs: timer.durationMs + ms, endsAt };
        } else if (timer.remainingMs !== null) {
          this.timer = { ...timer, durationMs: timer.durationMs + ms, remainingMs: Math.min(timer.remainingMs + ms, LIMITS.timerMaxMs) };
        } else {
          this.timer = { durationMs: ms, endsAt: now + ms, remainingMs: null };
        }
        break;
      }
      case 'reset':
        this.timer = { durationMs: 0, endsAt: null, remainingMs: null };
        break;
      default:
        throw new GameError('bad_request', 'Unknown timer action.');
    }
    this.changed();
  }

  /** Validates an emoji throw. Returns false when silently dropped (rate limit). */
  throwEmoji(fromId: string, toId: string, emoji: string): boolean {
    this.requirePlayer(fromId);
    if (!this.settings.funFeatures) throw new GameError('forbidden', 'Fun features are turned off in this game.');
    if (fromId === toId || !this.players.has(toId)) throw new GameError('bad_request', 'Pick another player.');
    if (!(THROWABLE_EMOJIS as readonly string[]).includes(emoji)) throw new GameError('bad_request', 'Unknown emoji.');
    const now = this.deps.now();
    const budget = this.emojiBudget.get(fromId) ?? { tokens: EMOJI_BURST, at: now };
    budget.tokens = Math.min(EMOJI_BURST, budget.tokens + (now - budget.at) * EMOJI_REFILL_PER_MS);
    budget.at = now;
    this.emojiBudget.set(fromId, budget);
    if (budget.tokens < 1) return false;
    budget.tokens -= 1;
    return true;
  }

  clearHistory(actorId: string): void {
    this.requirePlayer(actorId);
    this.require(actorId, 'manageGame');
    this.history = [];
    this.round.historyId = null;
    this.changed('history');
  }

  // ---------------------------------------------------------------------------------------
  // Views & persistence
  // ---------------------------------------------------------------------------------------

  /** Personalized state: hidden votes are only included for their own voter. */
  viewFor(viewerId: string): GameState {
    const round = this.round;
    const revealed = round.phase === 'revealed' ? round.revealed : null;
    const revealedVotes = revealed ? new Map(revealed.votes.map((v) => [v.playerId, v.value])) : null;
    const players = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        spectator: p.spectator,
        online: p.connections > 0,
        facilitator: this.facilitators.has(p.id),
        joinedAt: p.joinedAt,
        voted: revealedVotes ? revealedVotes.has(p.id) : round.votes.has(p.id),
        vote: revealedVotes ? (revealedVotes.get(p.id) ?? null) : p.id === viewerId ? (round.votes.get(p.id) ?? null) : null,
      }));
    const can: Capabilities = {
      reveal: this.can(viewerId, 'reveal'),
      manageIssues: this.can(viewerId, 'manageIssues'),
      manageGame: this.can(viewerId, 'manageGame'),
      manageFacilitators: this.can(viewerId, 'manageFacilitators'),
      deleteGame: this.can(viewerId, 'deleteGame'),
    };
    return {
      now: this.deps.now(),
      you: { id: viewerId, can },
      game: { id: this.id, name: this.name, createdAt: this.createdAt, deck: this.deck, settings: this.settings },
      players,
      round: {
        number: round.number,
        phase: round.phase,
        startedAt: round.startedAt,
        revealAt: round.revealAt,
        revealedAt: round.revealedAt,
        issueId: round.issueId,
        votes: revealed?.votes ?? null,
        stats: revealed?.stats ?? null,
        result: revealed ? (round.resultOverride ?? revealed.stats.suggested) : null,
        resultOverridden: revealed !== null && round.resultOverride !== null,
      },
      activeIssueId: this.activeIssueId,
      timer: this.timer,
      historyCount: this.history.length,
      historyVersion: this.historyVersion,
      issuesVersion: this.issuesVersion,
    };
  }

  toSnapshot(): RoomSnapshot {
    return {
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      deck: this.deck,
      settings: this.settings,
      facilitators: [...this.facilitators],
      players: [...this.players.values()].map(({ connections: _connections, ...rest }) => rest),
      round: { ...this.round, votes: [...this.round.votes.entries()] },
      issues: this.issues,
      activeIssueId: this.activeIssueId,
      history: this.history,
      timer: this.timer,
    };
  }

  static fromSnapshot(snapshot: RoomSnapshot, deps: RoomDeps): Room {
    const room = new Room(
      { id: snapshot.id, name: snapshot.name, deck: snapshot.deck, settings: tolerantSettings(snapshot.settings), createdAt: snapshot.createdAt },
      deps,
    );
    const now = deps.now();
    room.lastActiveAt = snapshot.lastActiveAt;
    for (const id of snapshot.facilitators) room.facilitators.add(id);
    // Everybody starts disconnected; the grace period lets clients reconnect after a restart.
    for (const player of snapshot.players) room.players.set(player.id, { ...player, lastSeenAt: now, connections: 0 });
    room.round = { ...snapshot.round, votes: new Map(snapshot.round.votes) };
    room.issues = snapshot.issues;
    room.activeIssueId = snapshot.activeIssueId;
    room.history = snapshot.history;
    room.timer = snapshot.timer;
    if (room.round.phase === 'revealing') {
      const remaining = (room.round.revealAt ?? now) - now;
      if (remaining > 0) room.scheduleReveal(remaining);
      else room.finishReveal();
    }
    return room;
  }

  /** Stops timers; called when the room is deleted or the server shuts down. */
  dispose(): void {
    this.revealTimer?.cancel();
    this.revealTimer = null;
    this.onChange = null;
  }

  private changed(kind: ChangeKind = 'state'): void {
    this.lastActiveAt = this.deps.now();
    if (kind === 'issues') this.issuesVersion++;
    if (kind === 'history') this.historyVersion++;
    this.onChange?.(kind);
  }
}

function parseLink(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const link = cleanUrl(value);
  if (!link) throw new GameError('bad_request', 'Links must start with http:// or https://');
  return link;
}

/** Settings read from disk: unknown keys or invalid values fall back to the defaults. */
function tolerantSettings(raw: unknown): GameSettings {
  let settings: GameSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return settings;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    try {
      settings = mergeSettings(settings, { [key]: (raw as Record<string, unknown>)[key] });
    } catch {
      // keep the default for this key
    }
  }
  return settings;
}

/** Applies a partial settings patch, rejecting unknown keys and wrong types. */
export function mergeSettings(base: GameSettings, patch: unknown): GameSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new GameError('bad_request', 'Invalid settings.');
  const next: GameSettings = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'revealBy':
      case 'manageIssuesBy':
        if (value !== 'everyone' && value !== 'facilitators') throw new GameError('bad_request', `Invalid value for ${key}.`);
        next[key] = value;
        break;
      case 'autoReveal':
      case 'showAverage':
      case 'countdown':
      case 'funFeatures':
        if (typeof value !== 'boolean') throw new GameError('bad_request', `Invalid value for ${key}.`);
        next[key] = value;
        break;
      default:
        throw new GameError('bad_request', `Unknown setting "${key}".`);
    }
  }
  return next;
}
