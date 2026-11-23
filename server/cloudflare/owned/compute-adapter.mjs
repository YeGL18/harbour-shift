// Compute transport only: D1 remains authoritative; no game/DO storage here.
import { isOperationsPath, operationsNotFound } from './fence-gate.mjs';
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const ROOM_ROUTE = /^\/v1\/rooms\/([A-Z0-9]{6})(?:\/(?:join|actions|heartbeat|horn))?\/?$/i;
const validIngress = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_EPOCH_MS;
const unavailable = () => new Response('Service temporarily unavailable.\n', {
  status: 503,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '5', 'X-Content-Type-Options': 'nosniff' },
});

export function computeActorName(request) {
  const match = ROOM_ROUTE.exec(new URL(request.url).pathname);
  return match ? `room:${match[1].toUpperCase()}` : 'registry';
}

export function createComputeClass(DurableObjectBase, authority) {
  if (typeof DurableObjectBase !== 'function' || !authority || typeof authority.fetch !== 'function') throw new TypeError('A DurableObject base and local authority are required');
  return class HarbourCompute extends DurableObjectBase {
    #environment;
    #context;
    constructor(ctx, env) { super(ctx, env); this.#context = ctx; this.#environment = env; }
    async forward(request, trustedReceivedAt) {
      if (!validIngress(trustedReceivedAt) || typeof this.#context?.waitUntil !== 'function') return unavailable();
      return authority.fetch(request, this.#environment, { waitUntil: this.#context.waitUntil.bind(this.#context) }, trustedReceivedAt);
    }
    // Public/stub HTTP cannot invent the trusted RPC ingress argument.
    async fetch() { return unavailable(); }
  };
}

export function createComputeRouter() {
  return {
    async fetch(request, env, _ctx) {
      const receivedAt = Date.now();
      if (isOperationsPath(request)) return operationsNotFound();
      const namespace = env?.HARBOUR_COMPUTE;
      if (!namespace || typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') return unavailable();
      const stub = namespace.get(namespace.idFromName(computeActorName(request)), { locationHint: 'apac' });
      if (!stub || typeof stub.forward !== 'function') return unavailable();
      // No body parsing, gzip manipulation or direct-core/network fallback.
      return stub.forward(request, receivedAt);
    },
  };
}
