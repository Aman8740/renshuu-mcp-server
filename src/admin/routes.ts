import { Router } from "express";
import type { Request, Response } from "express";

import { checkAdminCredentials, clearSessionCookie, createSessionCookie, getSessionUsername, requireAdmin } from "./auth.js";
import { ADMIN_DASHBOARD_HTML } from "./dashboardHtml.js";
import {
  getAuthMethodBreakdown,
  getOAuthFunnel,
  getOverview,
  getRecentErrors,
  getRecentEvents,
  getTimeseries,
  getToolBreakdown,
  getUsers,
} from "../analytics/query.js";

export function createAdminRouter(): Router {
  const router = Router();

  // ---- Dashboard page (public HTML shell — auth is enforced client-side
  //      by the SPA calling /admin/api/me, same pattern as any SPA) -------
  router.get("/admin", (_req: Request, res: Response) => {
    res.set("Content-Type", "text/html; charset=utf-8").send(ADMIN_DASHBOARD_HTML);
  });

  // ---- Auth ---------------------------------------------------------------

  router.post("/admin/api/login", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password || !checkAdminCredentials(username, password)) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const cookie = await createSessionCookie(username);
    res.setHeader("Set-Cookie", cookie);
    res.json({ ok: true });
  });

  router.post("/admin/api/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ ok: true });
  });

  router.get("/admin/api/me", async (req: Request, res: Response) => {
    const username = await getSessionUsername(req);
    if (!username) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    res.json({ username });
  });

  // ---- Data endpoints (all require a valid session) ------------------------

  const data = Router();
  data.use(requireAdmin());

  data.get("/overview", async (_req: Request, res: Response) => {
    res.json(await getOverview());
  });

  data.get("/timeseries", async (req: Request, res: Response) => {
    const range = req.query.range === "30d" ? "30d" : "24h";
    res.json(await getTimeseries(range));
  });

  data.get("/tools", async (_req: Request, res: Response) => {
    res.json(await getToolBreakdown());
  });

  data.get("/auth-methods", async (_req: Request, res: Response) => {
    res.json(await getAuthMethodBreakdown());
  });

  data.get("/activity", async (req: Request, res: Response) => {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    res.json(await getRecentEvents(limit));
  });

  data.get("/errors", async (req: Request, res: Response) => {
    const limit = Math.min(500, Number(req.query.limit) || 50);
    res.json(await getRecentErrors(limit));
  });

  data.get("/users", async (_req: Request, res: Response) => {
    res.json(await getUsers());
  });

  data.get("/oauth-funnel", async (_req: Request, res: Response) => {
    res.json(await getOAuthFunnel());
  });

  router.use("/admin/api", data);

  return router;
}
