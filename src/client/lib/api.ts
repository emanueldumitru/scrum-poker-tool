import type { CreateGameRequest, CreateGameResponse, GameInfoResponse } from '../../shared/protocol.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status}).`);
  return body;
}

export function createGame(input: CreateGameRequest): Promise<CreateGameResponse> {
  return request('/api/games', { method: 'POST', body: JSON.stringify(input) });
}

/** Resolves to null when the game does not exist. */
export async function fetchGameInfo(id: string): Promise<GameInfoResponse | null> {
  try {
    return await request<GameInfoResponse>(`/api/games/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
