# Multiplayer authority

This Worker runs the same deterministic game engine as solo play. It owns the room clock, dispatch, trip claims and rankings. D1 stores rooms, reconnect state and accounts. The Durable Object runs the authority.

## Run locally

From the repository root, install app dependencies with `npm ci` and use Wrangler 4.165.0.

```sh
node server/cloudflare/owned/build.mjs --rebuild-core
npx wrangler@4.165.0 d1 migrations apply DB --local --config server/cloudflare/owned/wrangler.local.example.jsonc
npx wrangler@4.165.0 d1 execute DB --local --config server/cloudflare/owned/wrangler.local.example.jsonc --command 'INSERT OR IGNORE INTO __harbour_migration_control (id, frozen) VALUES (1, 0)'
npx wrangler@4.165.0 dev --local --config server/cloudflare/owned/wrangler.local.example.jsonc
```

Initialize the control row only in a new local development database. The local service listens on port 8787. On the client, set `EXPO_PUBLIC_MULTIPLAYER_URL` as described in the [app README](../README.md).

For a separate deployment, see the [Worker binding template and schema notes](cloudflare/owned/README.md).
