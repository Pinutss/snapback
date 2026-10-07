import type { FileEntry } from "@zip.js/zip.js";
import type { SourceFile } from "./types";

// zip.js is only loaded when an archive is actually imported.
let zipLib: Promise<typeof import("@zip.js/zip.js")> | null = null;
const loadZip = () =>
  (zipLib ??= import("@zip.js/zip.js").then((z) => {
    // Native DecompressionStream is enough for Snapchat archives and avoids shipping a worker.
    z.configure({ useWebWorkers: false });
    return z;
  }));

export const PHOTO_EXT = ["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif"];
export const VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "3gp"];

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  json: "application/json",
};

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function mimeOf(name: string): string {
  return MIME[extOf(name)] ?? "application/octet-stream";
}

/** Is this file something the library cares about? */
function isWanted(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.startsWith(".") || path.includes("__MACOSX/")) return false;
  const ext = extOf(name);
  if (ext === "zip") return true;
  if (ext === "json") return name.toLowerCase().startsWith("memories_history");
  return PHOTO_EXT.includes(ext) || VIDEO_EXT.includes(ext);
}

export interface ScanProgress {
  /** Number of files found so far. */
  found: number;
  /** What we are currently reading (folder or archive name). */
  current: string;
}

type Report = (p: ScanProgress) => void;

function fromFile(file: File, path: string): SourceFile {
  return {
    path,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    getBlob: async () => file,
  };
}

function fromHandle(handle: FileSystemFileHandle, file: File, path: string): SourceFile {
  return {
    path,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    // Re-read through the handle so a stale File snapshot never breaks playback.
    getBlob: () => handle.getFile(),
  };
}

const NESTED_ZIP_LIMIT = 512 * 1024 * 1024;

/** Lists the media inside a zip without decompressing anything up front. */
async function expandZip(zip: SourceFile, out: SourceFile[], report: Report, depth = 0): Promise<void> {
  report({ found: out.length, current: zip.name });
  const { ZipReader, BlobReader, BlobWriter } = await loadZip();
  const reader = new ZipReader(new BlobReader(await zip.getBlob()));
  let entries;
  try {
    entries = await reader.getEntries();
  } catch (err) {
    console.warn(`[snapback] could not read ${zip.path}`, err);
    return;
  }
  for (const entry of entries) {
    if (entry.directory) continue;
    const inner = `${zip.path}/${entry.filename}`;
    if (!isWanted(inner)) continue;
    const fileEntry = entry as FileEntry;
    const name = entry.filename.slice(entry.filename.lastIndexOf("/") + 1);
    let cached: Promise<Blob> | null = null;
    const source: SourceFile = {
      path: inner,
      name,
      size: entry.uncompressedSize,
      lastModified: entry.lastModDate?.getTime() ?? zip.lastModified,
      // Memoized: zip entries are expensive to inflate twice in a row (thumbnail, then viewer).
      getBlob: () => {
        cached ??= fileEntry.getData(new BlobWriter(mimeOf(name))).catch((e) => {
          cached = null;
          throw e;
        });
        const p = cached;
        // Drop the reference once resolved so large videos can be garbage-collected.
        p.then(() => setTimeout(() => (cached = null), 30_000), () => {});
        return p;
      },
    };
    if (extOf(name) === "zip") {
      if (depth < 2 && source.size <= NESTED_ZIP_LIMIT) await expandZip(source, out, report, depth + 1);
      continue;
    }
    out.push(source);
    if (out.length % 200 === 0) report({ found: out.length, current: zip.name });
  }
}

async function finish(raw: SourceFile[], report: Report): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const f of raw) {
    if (extOf(f.name) === "zip") await expandZip(f, out, report);
    else out.push(f);
  }
  report({ found: out.length, current: "" });
  return out;
}

/** Recursively walks a directory picked with the File System Access API. */
export async function scanDirectoryHandle(root: FileSystemDirectoryHandle, report: Report): Promise<SourceFile[]> {
  const raw: SourceFile[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    report({ found: raw.length, current: prefix || dir.name });
    for await (const handle of dir.values()) {
      const path = prefix ? `${prefix}/${handle.name}` : handle.name;
      if (handle.kind === "directory") {
        if (handle.name.startsWith(".") || handle.name === "__MACOSX") continue;
        await walk(handle as FileSystemDirectoryHandle, path);
      } else if (isWanted(path)) {
        const fh = handle as FileSystemFileHandle;
        raw.push(fromHandle(fh, await fh.getFile(), path));
        if (raw.length % 200 === 0) report({ found: raw.length, current: prefix });
      }
    }
  };
  await walk(root, root.name);
  return finish(raw, report);
}

export async function scanFileHandles(handles: FileSystemFileHandle[], report: Report): Promise<SourceFile[]> {
  const raw: SourceFile[] = [];
  for (const h of handles) {
    if (isWanted(h.name)) raw.push(fromHandle(h, await h.getFile(), h.name));
  }
  return finish(raw, report);
}

/** Files coming from <input type="file"> (with or without webkitdirectory). */
export async function scanFileList(files: Iterable<File>, report: Report): Promise<SourceFile[]> {
  const raw: SourceFile[] = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (isWanted(path)) raw.push(fromFile(file, path));
  }
  return finish(raw, report);
}

/** Legacy drag & drop traversal (Firefox, Safari). */
export async function scanEntries(entries: FileSystemEntry[], report: Report): Promise<SourceFile[]> {
  const raw: SourceFile[] = [];
  const readAll = (reader: FileSystemDirectoryReader) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const all: FileSystemEntry[] = [];
      const next = () =>
        reader.readEntries((batch) => {
          if (!batch.length) return resolve(all);
          all.push(...batch);
          next();
        }, reject);
      next();
    });
  const walk = async (entry: FileSystemEntry, prefix: string) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      report({ found: raw.length, current: path });
      for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) await walk(child, path);
    } else if (isWanted(path)) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      raw.push(fromFile(file, path));
    }
  };
  for (const e of entries) await walk(e, "");
  return finish(raw, report);
}
