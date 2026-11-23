// Each developer can opt in to a separately configured multiplayer server.
export const MULTIPLAYER_BASE_URL = process.env.EXPO_PUBLIC_MULTIPLAYER_URL ?? '';

/** Alternate origins must use the same backend and database as the primary. */
export const MULTIPLAYER_FALLBACK_URLS: readonly string[] = [];
