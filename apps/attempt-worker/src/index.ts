import { Hono } from "hono";
import type { AppEnv } from "./env";
import attemptRoutes from "./routes/attempt";

const app = new Hono<AppEnv>({ strict: false });

app.get("/health", (c) => c.json({ ok: true }));
app.route("/internal/attempt", attemptRoutes);

app.notFound((c) => c.json({ error: "Not Found" }, 404));
app.onError((_, c) => c.json({ error: "Internal Server Error" }, 500));

export default { fetch: app.fetch };

