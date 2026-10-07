import { PHOTO_EXT, VIDEO_EXT, extOf } from "./sources";
import type { DateSource, MediaKind, Memory, SourceFile } from "./types";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

interface JsonEntry {
  date: number;
  kind: MediaKind | null;
  location?: { lat: number; lon: number };
  ids: string[];
  used: boolean;
}

/* ------------------------------------------------------------------ */
/* memories_history.json                                               */
/* ------------------------------------------------------------------ */

/** "2023-05-12 18:23:01 UTC" → ms */
function parseJsonDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = value.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** "Latitude, Longitude: 48.85, 2.35" → { lat, lon } (0,0 means "unknown" for Snapchat). */
function parseLocation(value: unknown): JsonEntry["location"] {
  if (typeof value !== "string") return undefined;
  const nums = value.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return undefined;
  const lat = parseFloat(nums[nums.length - 2]);
  const lon = parseFloat(nums[nums.length - 1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

function parseKind(value: unknown): MediaKind | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v.includes("video")) return "video";
  if (v.includes("image") || v.includes("photo")) return "photo";
  return null;
}

/** Finds the first array of objects that look like memories, whatever the key name. */
function findRecords(node: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4 || !node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    if (node.length && typeof node[0] === "object" && node[0] && "Date" in node[0]) return node;
    return [];
  }
  for (const v of Object.values(node)) {
    const found = findRecords(v, depth + 1);
    if (found.length) return found;
  }
  return [];
}

async function readJsonEntries(files: SourceFile[]): Promise<JsonEntry[]> {
  const out: JsonEntry[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await (await f.getBlob()).text());
      for (const rec of findRecords(data)) {
        const date = parseJsonDate(rec["Date"]);
        if (date == null) continue;
        const ids = new Set<string>();
        for (const v of Object.values(rec)) {
          if (typeof v === "string") for (const id of v.match(UUID_RE) ?? []) ids.add(id.toLowerCase());
        }
        out.push({
          date,
          kind: parseKind(rec["Media Type"]),
          location: parseLocation(rec["Location"]),
          ids: [...ids],
          used: false,
        });
      }
    } catch (err) {
      console.warn(`[snapback] unreadable ${f.path}`, err);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Dates from file names                                               */
/* ------------------------------------------------------------------ */

const valid = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60 && s < 60;

export function dateFromName(name: string): { date: number; hasTime: boolean } | null {
  // 2023-05-12, 2023-05-12_18-23-01, 2023-05-12 18.23.01 …
  let m = name.match(/(?:^|\D)(\d{4})-(\d{2})-(\d{2})(?:[ _T-](\d{2})[-.:h](\d{2})[-.:m](\d{2}))?/);
  if (m && valid(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))) {
    if (m[4]) return { date: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), hasTime: true };
    // Day only: noon UTC keeps the same calendar day in nearly every timezone.
    return { date: Date.UTC(+m[1], +m[2] - 1, +m[3], 12), hasTime: false };
  }
  // IMG_20230512_182301, PXL_20230512_182301123, Screenshot_20230512-182301 …
  m = name.match(/(?:^|\D)(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})\d{0,3}(?:\D|$)/);
  if (m && valid(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6])) {
    return { date: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), hasTime: true };
  }
  m = name.match(/(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/);
  if (m && valid(+m[1], +m[2], +m[3])) return { date: Date.UTC(+m[1], +m[2] - 1, +m[3], 12), hasTime: false };
  // Unix epoch in milliseconds.
  m = name.match(/(?:^|\D)(1[3-9]\d{11})(?:\D|$)/);
  if (m) return { date: +m[1], hasTime: true };
  return null;
}

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Build the library                                                   */
/* ------------------------------------------------------------------ */

export interface BuildProgress {
  step: "metadata" | "exif";
  done: number;
  total: number;
}

export async function buildMemories(
  files: SourceFile[],
  onProgress: (p: BuildProgress) => void,
): Promise<Memory[]> {
  const jsonFiles = files.filter((f) => extOf(f.name) === "json");
  const media = files.filter((f) => extOf(f.name) !== "json");

  onProgress({ step: "metadata", done: 0, total: media.length });
  const entries = await readJsonEntries(jsonFiles);
  const byId = new Map<string, JsonEntry>();
  for (const e of entries) for (const id of e.ids) byId.set(id, e);

  // 1. Pair "-main" files with their "-overlay" sibling, drop duplicates (same file imported twice).
  const groups = new Map<string, { main?: SourceFile; overlay?: SourceFile }>();
  const seen = new Set<string>();
  for (const f of media) {
    const dupKey = `${f.name}|${f.size}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    const m = f.name.match(/^(.*?)[-_](main|overlay)\.[^.]+$/i);
    const dir = f.path.slice(0, f.path.lastIndexOf("/") + 1);
    const base = m ? m[1] : f.name.replace(/\.[^.]+$/, "");
    // Snapchat sometimes ships overlays in a different archive part: group on the base name only.
    const groupKey = m ? base.toLowerCase() : `${dir}${f.name}`;
    const g = groups.get(groupKey) ?? {};
    if (m && m[2].toLowerCase() === "overlay") g.overlay = f;
    else g.main = f;
    groups.set(groupKey, g);
  }

  // 2. Resolve kind, date and location for each memory.
  const memories: Memory[] = [];
  const needsExif: Memory[] = [];
  const unmatched: { memory: Memory; day: string }[] = [];

  for (const { main, overlay } of groups.values()) {
    if (!main) continue;
    const ext = extOf(main.name);
    const kind: MediaKind | null = VIDEO_EXT.includes(ext) ? "video" : PHOTO_EXT.includes(ext) ? "photo" : null;
    if (!kind) continue;

    const ids = (main.name.match(UUID_RE) ?? []).map((s) => s.toLowerCase());
    const json = ids.map((id) => byId.get(id)).find(Boolean);
    const fromName = dateFromName(main.name);

    let date: number;
    let dateSource: DateSource;
    if (json) {
      json.used = true;
      date = json.date;
      dateSource = "json";
    } else if (fromName) {
      date = fromName.date;
      dateSource = "filename";
    } else {
      date = main.lastModified;
      dateSource = "file";
    }

    const key = `${main.name}|${main.size}`;
    const memory: Memory = {
      id: ids[0] ?? key,
      kind,
      date,
      dateSource,
      main,
      overlay,
      location: json?.location,
      key,
    };
    memories.push(memory);
    if (dateSource === "file" && kind === "photo") needsExif.push(memory);
    if (!json && fromName && !fromName.hasTime && entries.length) unmatched.push({ memory, day: dayKey(date) });
  }

  // 3. No id match but same day + same type in the JSON: borrow its exact time and place.
  if (unmatched.length) {
    const pool = new Map<string, JsonEntry[]>();
    for (const e of entries) {
      if (e.used) continue;
      const k = dayKey(e.date);
      pool.set(k, [...(pool.get(k) ?? []), e]);
    }
    for (const list of pool.values()) list.sort((a, b) => a.date - b.date);
    unmatched.sort((a, b) => a.memory.main.name.localeCompare(b.memory.main.name));
    for (const { memory, day } of unmatched) {
      const list = pool.get(day);
      if (!list?.length) continue;
      const i = list.findIndex((e) => !e.kind || e.kind === memory.kind);
      if (i < 0) continue;
      const [e] = list.splice(i, 1);
      memory.date = e.date;
      memory.dateSource = "json";
      memory.location = e.location;
    }
  }

  // 4. Last resort for loose photos: EXIF.
  let done = 0;
  onProgress({ step: "exif", done, total: needsExif.length });
  const queue = [...needsExif];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      try {
        const blob = await m.main.getBlob();
        const exifr = (await import("exifr")).default;
        const exif = await exifr.parse(blob, { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false });
        const d: unknown = exif?.DateTimeOriginal ?? exif?.CreateDate;
        if (d instanceof Date && !Number.isNaN(d.getTime())) {
          m.date = d.getTime();
          m.dateSource = "exif";
        }
        if (!m.location && Number.isFinite(exif?.latitude) && Number.isFinite(exif?.longitude)) {
          m.location = { lat: exif.latitude, lon: exif.longitude };
        }
      } catch {
        /* no EXIF: keep the file date */
      }
      done++;
      if (done % 25 === 0) onProgress({ step: "exif", done, total: needsExif.length });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  memories.sort((a, b) => b.date - a.date);
  return memories;
}
