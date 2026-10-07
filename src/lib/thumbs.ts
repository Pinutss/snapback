import { createStore, get, set, clear } from "idb-keyval";
import type { Memory, SourceFile } from "./types";

/** Bump when the thumbnail recipe changes so old cache entries are ignored. */
const VERSION = 2;
const BOX_W = 360;
const BOX_H = 480;

interface ThumbRecord {
  v: number;
  blob: Blob;
  duration?: number;
}

export interface Thumb {
  url: string;
  duration?: number;
}

const store = createStore("snapback-thumbs", "thumbs");

/* ------------------------------------------------------------------ */
/* Small LRU of object URLs                                            */
/* ------------------------------------------------------------------ */

class UrlLru<T extends { url: string }> {
  private map = new Map<string, T>();
  constructor(private max: number) {}
  get(key: string): T | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: T) {
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const [k, old] = this.map.entries().next().value!;
      this.map.delete(k);
      URL.revokeObjectURL(old.url);
    }
  }
  clear() {
    for (const v of this.map.values()) URL.revokeObjectURL(v.url);
    this.map.clear();
  }
}

const thumbUrls = new UrlLru<Thumb>(900);
const mediaUrls = new UrlLru<{ url: string }>(16);

/** Full-resolution object URL, cached so going back and forth in the viewer is instant. */
export async function mediaUrl(file: SourceFile): Promise<string> {
  const hit = mediaUrls.get(file.path);
  if (hit) return hit.url;
  const url = URL.createObjectURL(await file.getBlob());
  mediaUrls.set(file.path, { url });
  return url;
}

export function resetMediaCache() {
  thumbUrls.clear();
  mediaUrls.clear();
}

export async function clearThumbCache() {
  resetMediaCache();
  await clear(store);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(canvas: Canvas): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/webp", quality: 0.78 });
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/webp", 0.78),
  );
}

/** Draws `source` scaled to cover the thumbnail box, then the overlay stretched on top (like Snapchat). */
async function compose(source: CanvasImageSource, sw: number, sh: number, overlay?: SourceFile): Promise<Blob> {
  const scale = Math.min(1, Math.max(BOX_W / sw, BOX_H / sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(source, 0, 0, w, h);
  if (overlay) {
    try {
      const ov = await createImageBitmap(await overlay.getBlob());
      ctx.drawImage(ov, 0, 0, w, h);
      ov.close();
    } catch {
      /* broken overlay: keep the bare media */
    }
  }
  return toBlob(canvas);
}

async function renderPhoto(m: Memory): Promise<ThumbRecord> {
  const bmp = await createImageBitmap(await m.main.getBlob());
  try {
    return { v: VERSION, blob: await compose(bmp, bmp.width, bmp.height, m.overlay) };
  } finally {
    bmp.close();
  }
}

function renderVideo(m: Memory): Promise<ThumbRecord> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    let url = "";
    const timer = setTimeout(() => done(new Error("video thumbnail timeout")), 15_000);
    const done = (err: Error | null, rec?: ThumbRecord) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      if (url) URL.revokeObjectURL(url);
      if (err) reject(err);
      else resolve(rec!);
    };
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => done(new Error("video decode error"));
    video.onloadedmetadata = () => {
      const d = video.duration;
      video.currentTime = Number.isFinite(d) && d > 0 ? Math.min(0.4, d / 3) : 0;
    };
    video.onseeked = async () => {
      try {
        const blob = await compose(video, video.videoWidth || BOX_W, video.videoHeight || BOX_H, m.overlay);
        done(null, { v: VERSION, blob, duration: Number.isFinite(video.duration) ? video.duration : undefined });
      } catch (e) {
        done(e as Error);
      }
    };
    m.main
      .getBlob()
      .then((b) => {
        url = URL.createObjectURL(b);
        video.src = url;
      })
      .catch((e) => done(e));
  });
}

/* ------------------------------------------------------------------ */
/* Scheduler: newest requests first (= what is on screen), cancellable */
/* ------------------------------------------------------------------ */

interface Job {
  memory: Memory;
  resolve: (t: Thumb) => void;
  reject: (e: unknown) => void;
  waiters: number;
}

const jobs = new Map<string, Job>();
const stack: string[] = [];
const inflight = new Map<string, Promise<Thumb>>();
let running = 0;
let runningVideos = 0;
const MAX = 4;
const MAX_VIDEO = 2;

async function produce(memory: Memory): Promise<Thumb> {
  let rec = (await get<ThumbRecord>(memory.key, store).catch(() => undefined)) ?? undefined;
  if (!rec || rec.v !== VERSION) {
    rec = memory.kind === "video" ? await renderVideo(memory) : await renderPhoto(memory);
    set(memory.key, rec, store).catch(() => {});
  }
  const thumb = { url: URL.createObjectURL(rec.blob), duration: rec.duration };
  thumbUrls.set(memory.key, thumb);
  return thumb;
}

function pump() {
  for (let i = stack.length - 1; i >= 0 && running < MAX; i--) {
    const key = stack[i];
    const job = jobs.get(key)!;
    if (job.memory.kind === "video" && runningVideos >= MAX_VIDEO) continue;
    stack.splice(i, 1);
    jobs.delete(key);
    running++;
    if (job.memory.kind === "video") runningVideos++;
    produce(job.memory)
      .then(job.resolve, job.reject)
      .finally(() => {
        running--;
        if (job.memory.kind === "video") runningVideos--;
        pump();
      });
  }
}

/** Returns a cached thumbnail immediately when possible. */
export function peekThumb(memory: Memory): Thumb | undefined {
  return thumbUrls.get(memory.key);
}

export function requestThumb(memory: Memory, signal: AbortSignal): Promise<Thumb> {
  const hit = thumbUrls.get(memory.key);
  if (hit) return Promise.resolve(hit);
  const started = inflight.get(memory.key);
  if (started && !jobs.has(memory.key)) return started;

  let job = jobs.get(memory.key);
  if (!job) {
    let resolve!: (t: Thumb) => void;
    let reject!: (e: unknown) => void;
    const p = new Promise<Thumb>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    p.finally(() => inflight.delete(memory.key)).catch(() => {});
    inflight.set(memory.key, p);
    job = { memory, resolve, reject, waiters: 0 };
    jobs.set(memory.key, job);
  } else {
    // Seen again: bump to the top of the stack.
    stack.splice(stack.indexOf(memory.key), 1);
  }
  stack.push(memory.key);
  job.waiters++;
  const promise = inflight.get(memory.key)!;

  signal.addEventListener(
    "abort",
    () => {
      const j = jobs.get(memory.key);
      if (!j) return; // already started: let it finish and warm the cache
      if (--j.waiters <= 0) {
        jobs.delete(memory.key);
        stack.splice(stack.indexOf(memory.key), 1);
        inflight.delete(memory.key);
        j.reject(new DOMException("aborted", "AbortError"));
      }
    },
    { once: true },
  );
  queueMicrotask(pump);
  return promise;
}
