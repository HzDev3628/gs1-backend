import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { fileRecord, folderRoom } from "../helpers/files-folders.js";
import { bucket, db, id } from "../index.js";
import { auth, body, requireOwner, uniqueName } from "../helpers/user.js";
import { AppEnvType } from "../lib/types.js";
import { name } from "../index.js";

const files = new Hono<AppEnvType>();

files.patch("/files/:fileId", async (c) => {
  const user = await auth(c);
  const file = await fileRecord(id.parse(c.req.param("fileId")));
  await requireOwner(file.data_room_id, user.id);
  const input = body(
    z.object({ name: name.optional(), folderId: id.nullable().optional() }),
    await c.req.json(),
  );
  const nextFolder =
    input.folderId === undefined ? file.folder_id : input.folderId;
  if (nextFolder) {
    const folder = await folderRoom(nextFolder);
    if (folder.data_room_id !== file.data_room_id)
      throw new HTTPException(400, {
        message: "Destination is outside this data room",
      });
  }
  const nextName = await uniqueName(
    "files",
    file.data_room_id,
    nextFolder,
    input.name ?? file.name,
    file.id,
  );
  const { data, error } = await db
    .from("files")
    .update({
      folder_id: nextFolder,
      name: nextName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", file.id)
    .select()
    .single();
  if (error) throw error;
  return c.json({ file: data });
});

files.delete("/files/:fileId", async (c) => {
  const user = await auth(c);
  const file = await fileRecord(id.parse(c.req.param("fileId")));
  await requireOwner(file.data_room_id, user.id);
  const { error: storageError } = await db.storage
    .from(bucket)
    .remove([file.storage_path]);
  if (storageError) throw storageError;
  const { error } = await db.from("files").delete().eq("id", file.id);
  if (error) throw error;
  return c.body(null, 204);
});

files.get("/files/:fileId/view", async (c) => {
  const user = await auth(c);
  const file = await fileRecord(id.parse(c.req.param("fileId")));
  await requireOwner(file.data_room_id, user.id);
  const { data, error } = await db.storage
    .from(bucket)
    .createSignedUrl(file.storage_path, 60 * 10);
  if (error) throw error;
  return c.json({ url: data.signedUrl });
});

export default files;