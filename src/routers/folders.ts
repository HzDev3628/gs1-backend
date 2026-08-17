import { Hono } from "hono";
import { z } from "zod";
import { descendantFolderIds, folderRoom } from "../helpers/files-folders.js";
import { bucket, db, id } from "../index.js";
import { auth, body, requireOwner, uniqueName } from "../helpers/user.js";
import { AppEnvType } from "../lib/types.js";
import { name } from "../index.js";

const folders = new Hono<AppEnvType>();

folders.patch("/folders/:folderId", async (c) => {
  const user = await auth(c);
  const folder = await folderRoom(id.parse(c.req.param("folderId")));
  await requireOwner(folder.data_room_id, user.id);
  const input = body(z.object({ name }), await c.req.json());
  const resolvedName = await uniqueName(
    "folders",
    folder.data_room_id,
    folder.parent_id,
    input.name,
    folder.id,
  );
  const { data, error } = await db
    .from("folders")
    .update({ name: resolvedName, updated_at: new Date().toISOString() })
    .eq("id", folder.id)
    .select()
    .single();
  if (error) throw error;
  return c.json({ folder: data });
});

folders.delete("/folders/:folderId", async (c) => {
  const user = await auth(c);
  const folder = await folderRoom(id.parse(c.req.param("folderId")));
  await requireOwner(folder.data_room_id, user.id);
  const subtree = await descendantFolderIds(folder.id);
  const { data: docs, error: docsError } = await db
    .from("files")
    .select("storage_path")
    .in("folder_id", subtree);
  if (docsError) throw docsError;
  if (docs?.length) {
    const { error } = await db.storage
      .from(bucket)
      .remove(docs.map((doc) => doc.storage_path));
    if (error) throw error;
  }
  const { error } = await db.from("folders").delete().eq("id", folder.id);
  if (error) throw error;
  return c.body(null, 204);
});

export default folders;