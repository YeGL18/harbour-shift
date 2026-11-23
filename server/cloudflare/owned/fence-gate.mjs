// Permanent read-only maintenance gate. No administration or initialization API.
const CONTROL_SQL = 'SELECT frozen FROM __harbour_migration_control WHERE id=1';
const json = (status, value) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' },
});
const pathOf = request => new URL(request.url).pathname.toLowerCase().replace(/\/+$/, '') || '/';
export const isOperationsPath = request => {
  const path = pathOf(request);
  return path === '/__ops' || path.startsWith('/__ops/');
};
export const operationsNotFound = () => json(404, { error: { code: 'not_found', message: 'Not found.' } });

function unavailable(health, failedRead) {
  return health
    ? json(503, { ok: false, service: 'harbour-shift-authority', protocolVersion: 2, persistence: 'd1', maintenance: true })
    : json(503, { error: { code: failedRead ? 'migration_control_unavailable' : 'migration_maintenance', message: '伺服器暫時未能處理，請稍後再試' } });
}

export function createFenceGate(authority, { now = Date.now } = {}) {
  if (!authority || typeof authority.fetch !== 'function') throw new TypeError('A local authority fetch handler is required');
  return {
    async fetch(request, env, ctx, trustedReceivedAt) {
      // Preserve Edge ingress across this D1 await and the core's lazy startup.
      const arrivedAt = now();
      const receivedAt = Number.isSafeInteger(trustedReceivedAt) && trustedReceivedAt > 0 ? trustedReceivedAt : arrivedAt;
      if (isOperationsPath(request)) return operationsNotFound();
      const path = pathOf(request), health = path === '/' || path === '/health';
      if (health || path === '/v1' || path.startsWith('/v1/')) {
        let control;
        try { control = await env.DB.prepare(CONTROL_SQL).first(); }
        catch { return unavailable(health, true); }
        if (!control || control.frozen !== 0) return unavailable(health, false);
      }
      // Keep the exact Response, headers and byte stream, including gzip.
      return authority.fetch(request, env, ctx, receivedAt);
    },
  };
}
