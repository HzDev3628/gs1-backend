import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { db } from "../index.js";
import { User } from "@supabase/supabase-js";

export const body = <T extends z.ZodType>(schema: T, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
  return parsed.data;
};

export const auth = async (c: Context<{ Variables: { user: User } }>) => {
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HTTPException(401, { message: "Sign in is required" });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new HTTPException(401, { message: "Your session has expired" });
  c.set("user", data.user);
  return data.user;
};

export const optionalUser = async (c: Context) => {
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data.user ?? null;
};

export const requireOwner = async (roomId: string, userId: string) => {
  const { data } = await db
    .from("data_rooms")
    .select("*")
    .eq("id", roomId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!data) throw new HTTPException(404, { message: "Data room not found" });
  return data;
};

export const uniqueName = async (
  table: "folders" | "files",
  roomId: string,
  parentId: string | null,
  rawName: string,
  ignoreId?: string,
) => {
  const base = rawName.replace(/\s+/g, " ").trim();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : "";
  let candidate = base;
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const parentColumn = table === "folders" ? "parent_id" : "folder_id";
    let query = db
      .from(table)
      .select("id")
      .eq("data_room_id", roomId)
      .eq("name", candidate);
    query =
      parentId === null
        ? query.is(parentColumn, null)
        : query.eq(parentColumn, parentId);
    if (ignoreId) query = query.neq("id", ignoreId);
    const { data } = await query.maybeSingle();
    if (!data) return candidate;
    candidate = `${stem} (${suffix})${extension}`;
  }
  throw new HTTPException(409, { message: "Could not resolve a unique name" });
};