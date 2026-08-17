import { serve } from "@hono/node-server";
import { createClient, type User } from "@supabase/supabase-js";
import { cors } from "hono/cors";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import "dotenv/config";
import rooms from "./routers/rooms.js";
import folders from "./routers/folders.js";
import files from "./routers/files.js";
import shares from "./routers/shares.js";

const configuredEnv = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    FRONTEND_URL: z.string().url().default("http://localhost:5173"),
    PORT: z.coerce.number().default(3001),
  })
  .parse(process.env);

const serverKey =
  configuredEnv.SUPABASE_SECRET_KEY ?? configuredEnv.SUPABASE_SERVICE_ROLE_KEY;
export const env = configuredEnv;
export const db = createClient(env.SUPABASE_URL, serverKey!);
export const bucket = "data-room-files";
export const id = z.string().uuid();
export const name = z.string().trim().min(1, "Name is required").max(255);

const app = new Hono<{ Variables: { user: User } }>();

app.use(
  "*",
  cors({
    origin: env.FRONTEND_URL,
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE"],
  }),
);

app.onError((error, c) => {
  console.error(error);
  if (error instanceof HTTPException) return error.getResponse();
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});
app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/", rooms);
app.route("/", folders);
app.route("/", files);
app.route("/", shares);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`doc-converter-service listening on :${info.port}`);
});
