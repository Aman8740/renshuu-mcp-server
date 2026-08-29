import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { decryptPayload, encryptPayload } from "../oauth/crypto.js";

const SESSION_COOKIE_NAME = "admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

interface AdminSessionPayload extends Record<string, unknown> {
  type: "admin_session";
  username: string;
}

/** Constant-time comparison so a login attempt can't be timed to learn the correct username/password byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length so failure here isn't itself a timing signal.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function checkAdminCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUsername || !expectedPassword) return false;
  return safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export async function createSessionCookie(username: string): Promise<string> {
  const token = await encryptPayload({ type: "admin_session", username }, SESSION_TTL_SECONDS);
  const isProd = process.env.NODE_ENV !== "development";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; ${isProd ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function getSessionUsername(req: Request): Promise<string | undefined> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return undefined;
  try {
    const payload = await decryptPayload<AdminSessionPayload>(token);
    if (payload.type !== "admin_session") return undefined;
    return payload.username;
  } catch {
    return undefined;
  }
}

/** Express middleware — 401s any /admin/api/* route without a valid session cookie. */
export function requireAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const username = await getSessionUsername(req);
    if (!username) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    next();
  };
}
