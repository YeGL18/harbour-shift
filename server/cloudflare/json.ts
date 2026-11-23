/** Stream wire snapshots without retaining a second full JSON copy in a Worker. */
function* tokens(value: unknown): Generator<string> {
  if (value === null || typeof value !== 'object') { yield JSON.stringify(value) ?? 'null'; return; }
  if (Array.isArray(value)) {
    yield '[';
    for (let i = 0; i < value.length; i++) { if (i) yield ','; yield* tokens(value[i]); }
    yield ']'; return;
  }
  yield '{'; let first = true;
  for (const key of Object.keys(value)) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue;
    if (!first) yield ','; first = false;
    yield JSON.stringify(key); yield ':'; yield* tokens(entry);
  }
  yield '}';
}
/** Honor explicit gzip exclusions even when a wildcard is also acceptable. */
export function acceptsGzip(value: string | null | undefined): boolean {
  let gzip: number | undefined, wildcard = 0;
  for (const item of (value || '').split(',')) {
    const [coding, ...parameters] = item.trim().toLowerCase().split(';');
    if (coding !== 'gzip' && coding !== '*') continue;
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const parsed = quality === undefined ? 1 : Number(quality.trim().slice(2));
    const q = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    if (coding === 'gzip') gzip = Math.max(gzip ?? 0, q);
    else wildcard = Math.max(wildcard, q);
  }
  return (gzip ?? wildcard) > 0;
}

export function streamedJson(value: unknown, init?: ResponseInit, acceptEncoding?: string | null): Response {
  const iterator = tokens(value), encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      let chunk = '';
      while (chunk.length < 16_384) {
        const next = iterator.next();
        if (next.done) { if (chunk) controller.enqueue(encoder.encode(chunk)); controller.close(); return; }
        chunk += next.value;
      }
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() { iterator.return?.(undefined); },
  });
  const headers = new Headers(init?.headers); headers.set('Content-Type', 'application/json; charset=utf-8');
  const vary = headers.get('Vary');
  if (!vary?.split(',').some(value => /^(accept-encoding|\*)$/i.test(value.trim()))) headers.set('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  headers.delete('Content-Length');
  if (acceptsGzip(acceptEncoding)) {
    headers.set('Content-Encoding', 'gzip');
    // This stream already contains gzip bytes. Workers' default automatic
    // encoding would compress those bytes a second time on the HTTP boundary.
    const compressedInit: ResponseInit & { encodeBody: 'manual' } = { ...init, headers, encodeBody: 'manual' };
    return new Response(stream.pipeThrough(new CompressionStream('gzip')), compressedInit);
  }
  headers.delete('Content-Encoding');
  return new Response(stream, { ...init, headers });
}
