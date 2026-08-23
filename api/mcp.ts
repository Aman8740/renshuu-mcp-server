/**
 * Vercel serverless function entry point.
 *
 * Fixed from an earlier version that caused a 404 on every route. Two
 * changes from that version, both addressing real risks flagged (but
 * unverified, since this sandbox has no network path to Vercel) when this
 * was first written:
 *
 * 1. RENAMED from api/index.ts to api/mcp.ts. Vercel special-cases a file
 *    literally named "index" under api/ similarly to how index.html works
 *    for static routing — it may resolve to /api rather than /api/index.
 *    The old vercel.json rewrote everything to "/api/index", which likely
 *    never matched a real deployed route. Naming this file "mcp" removes
 *    the ambiguity entirely.
 *
 * 2. Imports directly from ../src/index.js (TypeScript source) instead of
 *    ../dist/index.js (compiled output). The old approach depended on
 *    vercel.json's buildCommand ("npm run build") having fully populated
 *    dist/ before Vercel's function bundler traced this import — an
 *    ordering assumption that was never actually verified against live
 *    Vercel infrastructure. Vercel's Node.js function bundler compiles
 *    TypeScript in the function's own import graph natively, so importing
 *    the .ts source directly removes this entire class of build-order
 *    risk rather than trying to get the ordering right.
 *
 * Routing: vercel.json rewrites all incoming paths to this function, so
 * the app's own internal routes (/health, /mcp) are matched against the
 * ORIGINAL request path exactly as they would be on any other host.
 */

import { createHttpApp } from "../src/index.js";

export default createHttpApp();
