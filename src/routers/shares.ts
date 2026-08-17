import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  folderRoom,
  descendantFolderIds,
  filesWithSignedUrls,
} from "../helpers/files-folders.js";
import { auth, optionalUser, requireOwner } from "../helpers/user.js";
import { bucket, db, id } from "../index.js";
import { AppEnvType } from "../lib/types.js";

const shares = new Hono<AppEnvType>();

shares.delete("/shares/:shareId", async (c) => {
  const user = await auth(c);
  const shareId = id.parse(c.req.param("shareId"));
  const { data } = await db
    .from("shares")
    .select("data_room_id")
    .eq("id", shareId)
    .maybeSingle();
  if (!data) throw new HTTPException(404, { message: "Share not found" });
  await requireOwner(data.data_room_id, user.id);
  const { error } = await db
    .from("shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId);
  if (error) throw error;
  return c.body(null, 204);
});

shares.get("/shared/:token", async (c) => {
  const token = id.parse(c.req.param("token"));
  const { data: share, error } = await db
    .from("shares")
    .select("*")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!share)
    throw new HTTPException(404, {
      message: "This sharing link is invalid or has been revoked.",
    });
  if (share.access_type === "user") {
    const user = await optionalUser(c);
    if (
      !user?.email ||
      user.email.toLowerCase() !== share.recipient_email?.toLowerCase()
    )
      throw new HTTPException(403, {
        message:
          "Sign in with the email address this document was shared with.",
      });
  }
  if (share.target_type === "room") {
    const [{ data: room }, { data: folders }, { data: files }] =
      await Promise.all([
        db
          .from("data_rooms")
          .select("id,name,description")
          .eq("id", share.target_id)
          .maybeSingle(),
        db
          .from("folders")
          .select("id,name,parent_id,created_at")
          .eq("data_room_id", share.data_room_id)
          .order("name"),
        db
          .from("files")
          .select(
            "id,name,folder_id,mime_type,size_bytes,created_at,storage_path",
          )
          .eq("data_room_id", share.data_room_id)
          .order("name"),
      ]);
    const docs = await filesWithSignedUrls(files ?? []);
    return c.json({ targetType: "room", room, folders, files: docs });
  }
  if (share.target_type === "folder") {
    const folder = await folderRoom(share.target_id);
    const folderIds = await descendantFolderIds(folder.id);
    const [{ data: folders }, { data: files }] = await Promise.all([
      db
        .from("folders")
        .select("id,name,parent_id,created_at")
        .in("id", folderIds)
        .order("name"),
      db
        .from("files")
        .select(
          "id,name,folder_id,mime_type,size_bytes,created_at,storage_path",
        )
        .in("folder_id", folderIds)
        .order("name"),
    ]);
    const docs = await filesWithSignedUrls(files ?? []);
    return c.json({
      targetType: "folder",
      folder: { id: folder.id, name: folder.name },
      folders,
      files: docs,
    });
  }
  const { data: file } = await db
    .from("files")
    .select("id,name,mime_type,size_bytes,storage_path")
    .eq("id", share.target_id)
    .maybeSingle();
  if (!file)
    throw new HTTPException(404, {
      message: "The shared file no longer exists.",
    });
  const { data: signed, error: signedError } = await db.storage
    .from(bucket)
    .createSignedUrl(file.storage_path, 60 * 10);
  if (signedError) throw signedError;
  return c.json({
    targetType: "file",
    file: { ...file, url: signed.signedUrl },
  });
});

export default shares;