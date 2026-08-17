import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { folderRoom } from "../helpers/files-folders.js";
import { bucket, db, env, id } from "../index.js";
import { auth, body, requireOwner, uniqueName } from "../helpers/user.js";
import { AppEnvType } from "../lib/types.js";
import { name } from "../index.js";

const rooms = new Hono<AppEnvType>();

rooms.get("/rooms", async (c) => {
  const user = await auth(c);
  const { data, error } = await db
    .from("data_rooms")
    .select("*, folders(count), files(count)")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return c.json({ rooms: data });
});

rooms.post("/rooms", async (c) => {
  const user = await auth(c);
  const input = body(
    z.object({ name, description: z.string().trim().max(500).optional() }),
    await c.req.json(),
  );
  const { data, error } = await db
    .from("data_rooms")
    .insert({ owner_id: user.id, ...input })
    .select()
    .single();
  if (error) throw error;
  return c.json({ room: data }, 201);
});

rooms.patch("/rooms/:roomId", async (c) => {
  const user = await auth(c);
  const roomId = id.parse(c.req.param("roomId"));
  await requireOwner(roomId, user.id);
  const input = body(
    z.object({
      name: name.optional(),
      description: z.string().trim().max(500).nullable().optional(),
    }),
    await c.req.json(),
  );
  const { data, error } = await db
    .from("data_rooms")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", roomId)
    .select()
    .single();
  if (error) throw error;
  return c.json({ room: data });
});

rooms.delete("/rooms/:roomId", async (c) => {
  const user = await auth(c);
  const roomId = id.parse(c.req.param("roomId"));
  await requireOwner(roomId, user.id);
  const { data: docs } = await db
    .from("files")
    .select("storage_path")
    .eq("data_room_id", roomId);
  if (docs?.length)
    await db.storage.from(bucket).remove(docs.map((doc) => doc.storage_path));
  const { error } = await db.from("data_rooms").delete().eq("id", roomId);
  if (error) throw error;
  return c.body(null, 204);
});

rooms.get("/rooms/:roomId/contents", async (c) => {
  const user = await auth(c);
  const roomId = id.parse(c.req.param("roomId"));
  await requireOwner(roomId, user.id);

  const folderId = c.req.query("folderId")
    ? id.parse(c.req.query("folderId"))
    : null;

  if (folderId) {
    const folder = await folderRoom(folderId);
    if (folder.data_room_id !== roomId)
      throw new HTTPException(404, { message: "Folder not found" });
  }
  const [folders, files, room] = await Promise.all([
    folderId
      ? db
          .from("folders")
          .select("*")
          .eq("data_room_id", roomId)
          .eq("parent_id", folderId)
          .order("name")
      : db
          .from("folders")
          .select("*")
          .eq("data_room_id", roomId)
          .is("parent_id", null)
          .order("name"),
    folderId
      ? db
          .from("files")
          .select("*")
          .eq("data_room_id", roomId)
          .eq("folder_id", folderId)
          .order("name")
      : db
          .from("files")
          .select("*")
          .eq("data_room_id", roomId)
          .is("folder_id", null)
          .order("name"),
    db.from("data_rooms").select("*").eq("id", roomId).single(),
  ]);

  if (folders.error || files.error || room.error)
    throw folders.error || files.error || room.error;
  const crumbs: Array<{ id: string | null; name: string }> = [
    { id: null, name: room.data.name },
  ];

  let cursor = folderId;

  while (cursor) {
    const node = await folderRoom(cursor);
    crumbs.splice(1, 0, { id: node.id, name: node.name });
    cursor = node.parent_id;
  }

  return c.json({
    room: room.data,
    folders: folders.data,
    files: files.data,
    breadcrumbs: crumbs,
  });
});

rooms.post("/rooms/:roomId/folders", async (c) => {
  const user = await auth(c);
  const roomId = id.parse(c.req.param("roomId"));
  await requireOwner(roomId, user.id);

  const input = body(
    z.object({ name, parentId: id.nullable().optional() }),
    await c.req.json(),
  );

  const parentId = input.parentId ?? null;

  if (parentId) {
    const parent = await folderRoom(parentId);
    if (parent.data_room_id !== roomId)
      throw new HTTPException(400, {
        message: "Parent folder is outside this data room",
      });
  }

  const resolvedName = await uniqueName(
    "folders",
    roomId,
    parentId,
    input.name,
  );
  
  const { data, error } = await db
    .from("folders")
    .insert({ data_room_id: roomId, parent_id: parentId, name: resolvedName })
    .select()
    .single();
  if (error) throw error;
  return c.json({ folder: data }, 201);
});

rooms.post("/rooms/:roomId/uploads/sign", async (c) => {
  const user = await auth(c);
  const roomId = id.parse(c.req.param("roomId"));
  await requireOwner(roomId, user.id);
  const input = body(
    z.object({
      name,
      folderId: id.nullable(),
      mimeType: z.string().min(1).max(255),
      sizeBytes: z
        .number()
        .int()
        .nonnegative()
        .max(200 * 1024 * 1024),
    }),
    await c.req.json(),
  );
  if (input.folderId) {
    const folder = await folderRoom(input.folderId);
    if (folder.data_room_id !== roomId)
      throw new HTTPException(400, {
        message: "Folder is outside this data room",
      });
  }
  const resolvedName = await uniqueName(
    "files",
    roomId,
    input.folderId,
    input.name,
  );
  const storagePath = `${roomId}/${crypto.randomUUID()}-${resolvedName}`;
  const { data: signed, error: signError } = await db.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);
  if (signError) throw signError;
  return c.json({
    name: resolvedName,
    storagePath,
    token: signed.token,
    signedUrl: signed.signedUrl,
  });
});

rooms.post("/rooms/:roomId/files", async (c) => {
  const user = await auth(c);
  const roomId = id.parse(c.req.param("roomId"));
  await requireOwner(roomId, user.id);
  const input = body(
    z.object({
      name,
      folderId: id.nullable(),
      storagePath: z.string().min(1),
      mimeType: z.string().min(1),
      sizeBytes: z.number().int().nonnegative(),
    }),
    await c.req.json(),
  );
  if (!input.storagePath.startsWith(`${roomId}/`))
    throw new HTTPException(400, { message: "Invalid upload location" });
  const { data, error } = await db
    .from("files")
    .insert({
      data_room_id: roomId,
      folder_id: input.folderId,
      name: input.name,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
    })
    .select()
    .single();
  if (error) throw error;
  return c.json({ file: data }, 201);
});



rooms.get("/rooms/:roomId/shares", async (c) => {
  const user = await auth(c);
  const roomId = id.parse(c.req.param("roomId"));
  await requireOwner(roomId, user.id);
  const { data, error } = await db
    .from("shares")
    .select("*")
    .eq("data_room_id", roomId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return c.json({ shares: data });
});

rooms.post("/rooms/:roomId/shares", async (c) => {
  const user = await auth(c);
  const roomId = id.parse(c.req.param("roomId"));
  await requireOwner(roomId, user.id);
  const input = body(
    z.discriminatedUnion("accessType", [
      z.object({
        targetType: z.enum(["room", "folder", "file"]),
        targetId: id,
        accessType: z.literal("link"),
      }),
      z.object({
        targetType: z.enum(["room", "folder", "file"]),
        targetId: id,
        accessType: z.literal("user"),
        recipientEmail: z.string().email(),
      }),
    ]),
    await c.req.json(),
  );
  const { data, error } = await db
    .from("shares")
    .insert({
      data_room_id: roomId,
      target_type: input.targetType,
      target_id: input.targetId,
      access_type: input.accessType,
      recipient_email:
        input.accessType === "user" ? input.recipientEmail.toLowerCase() : null,
      created_by: user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return c.json(
    { share: data, url: `${env.FRONTEND_URL}/shared/${data.token}` },
    201,
  );
});

export default rooms;