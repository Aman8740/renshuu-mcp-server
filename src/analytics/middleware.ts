import type { Response } from "express";

/**
 * Wraps res.write/res.end to keep a copy of every chunk sent, without
 * changing what actually reaches the client (works for both a single JSON
 * response and an SSE stream — nothing here buffers or delays real output,
 * it only observes a duplicate).
 *
 * Used to give the analytics logger a lightweight, best-effort way to tell
 * whether an MCP call actually succeeded: the Streamable HTTP transport
 * returns HTTP 200 even for a JSON-RPC-level error (that's correct per
 * spec), so a bare status-code check under-counts failures. Scanning the
 * captured text for a top-level `"error"` field is a heuristic, not a full
 * JSON-RPC parse — it's deliberately kept simple rather than risk breaking
 * on a streamed response, and it's accurate enough for a dashboard error
 * rate, not meant as ground truth for anything more precise.
 */
export function captureResponseText(res: Response): { getText: () => string } {
  const chunks: Buffer[] = [];
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.write = ((chunk: any, ...args: any[]) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return originalWrite(chunk, ...args);
  }) as typeof res.write;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.end = ((chunk?: any, ...args: any[]) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return originalEnd(chunk, ...args);
  }) as typeof res.end;

  return {
    getText: () => Buffer.concat(chunks).toString("utf8"),
  };
}

/** True if the captured body looks like it carries a JSON-RPC error, at any nesting depth (covers SSE's `data: {...}` lines too). */
export function looksLikeJsonRpcError(capturedText: string): boolean {
  return /"error"\s*:\s*\{/.test(capturedText);
}
