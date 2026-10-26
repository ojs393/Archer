import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../context.ts";
import { SESSION_COOKIE } from "../security.ts";

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "strict" });
}

export function sessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/session", async (_request, reply) => {
    setSessionCookie(reply, ctx.sessionToken);
    return reply.code(204).send();
  });
}
