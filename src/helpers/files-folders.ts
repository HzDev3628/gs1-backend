import { HTTPException } from "hono/http-exception";
import { bucket, db } from "../index.js";

export const folderRoom = async (folderId: string) => {
  const { data } = await db
    .from("folders")
    .select("*")
    .eq("id", folderId)
    .maybeSingle();
  if (!data) throw new HTTPException(404, { message: "Folder not found" });
  return data;
};

export const fileRecord = async (fileId: string) => {
  const { data } = await db
    .from("files")
    .select("*")
    .eq("id", fileId)
    .maybeSingle();
  if (!data) throw new HTTPException(404, { message: "File not found" });
  return data;
};

export const descendantFolderIds = async (rootId: string) => {
  const ids = [rootId];
  for (let index = 0; index < ids.length; index += 1) {
    const { data, error } = await db
      .from("folders")
      .select("id")
      .eq("parent_id", ids[index]);
    if (error) throw error;
    ids.push(...(data ?? []).map((folder) => folder.id));
  }
  return ids;
};

export const filesWithSignedUrls = async (
  files: Array<{ storage_path: string; [key: string]: unknown }>,
) =>
  Promise.all(
    files.map(async ({ storage_path, ...file }) => {
      const { data, error } = await db.storage
        .from(bucket)
        .createSignedUrl(storage_path, 600);
      if (error || !data)
        throw (
          error ??
          new HTTPException(404, {
            message: "A shared file is no longer available.",
          })
        );
      return { ...file, url: data.signedUrl };
    }),
  );