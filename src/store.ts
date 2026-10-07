import { create } from "zustand";
import { del, get, set } from "idb-keyval";
import { buildMemories } from "./lib/parse";
import { scanDirectoryHandle, scanEntries, scanFileHandles, scanFileList, type ScanProgress } from "./lib/sources";
import { resetMediaCache } from "./lib/thumbs";
import { t } from "./lib/i18n";
import type { Memory, SourceFile } from "./lib/types";

export type Filter = "all" | "photo" | "video";

export interface ViewerState {
  list: Memory[];
  index: number;
  /** Story mode auto-advances (flashbacks); grid mode waits for the user. */
  story: boolean;
}

export interface Progress {
  label: string;
  found?: number;
  done?: number;
  total?: number;
  current?: string;
}

/** What the user can import. Handles are persisted, plain files are not. */
export type ImportInput =
  | { kind: "dir"; handle: FileSystemDirectoryHandle }
  | { kind: "handles"; handles: FileSystemFileHandle[] }
  | { kind: "files"; files: File[] }
  | { kind: "entries"; entries: FileSystemEntry[] };

const ROOTS_KEY = "snapback-roots";

interface State {
  status: "idle" | "loading" | "ready";
  progress: Progress | null;
  error: string | null;
  memories: Memory[];
  sources: SourceFile[];
  /** Handles saved from a previous visit, waiting for the user to re-grant access. */
  savedRoots: FileSystemHandle[];
  filter: Filter;
  viewer: ViewerState | null;

  init(): Promise<void>;
  importFrom(inputs: ImportInput[], append?: boolean): Promise<void>;
  resume(): Promise<void>;
  closeLibrary(): Promise<void>;
  setFilter(f: Filter): void;
  openViewer(list: Memory[], index: number, story?: boolean): void;
  setViewerIndex(index: number): void;
  closeViewer(): void;
}

async function scan(input: ImportInput, report: (p: ScanProgress) => void): Promise<SourceFile[]> {
  switch (input.kind) {
    case "dir":
      return scanDirectoryHandle(input.handle, report);
    case "handles":
      return scanFileHandles(input.handles, report);
    case "files":
      return scanFileList(input.files, report);
    case "entries":
      return scanEntries(input.entries, report);
  }
}

function rootsOf(inputs: ImportInput[]): FileSystemHandle[] {
  return inputs.flatMap((i): FileSystemHandle[] => (i.kind === "dir" ? [i.handle] : i.kind === "handles" ? i.handles : []));
}

async function ensurePermission(handle: FileSystemHandle, ask: boolean): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: "read" })) === "granted") return true;
  if (!ask || !handle.requestPermission) return false;
  return (await handle.requestPermission({ mode: "read" })) === "granted";
}

export const useStore = create<State>((setState, getState) => ({
  status: "idle",
  progress: null,
  error: null,
  memories: [],
  sources: [],
  savedRoots: [],
  filter: "all",
  viewer: null,

  async init() {
    const roots = (await get<FileSystemHandle[]>(ROOTS_KEY).catch(() => undefined)) ?? [];
    if (!roots.length) return;
    setState({ savedRoots: roots });
    // Chrome may have kept the permission ("allow on every visit"): reopen silently.
    const granted = await Promise.all(roots.map((r) => ensurePermission(r, false).catch(() => false)));
    if (granted.every(Boolean)) await getState().resume();
  },

  async resume() {
    const roots = getState().savedRoots;
    for (const r of roots) {
      if (!(await ensurePermission(r, true).catch(() => false))) return;
    }
    const inputs: ImportInput[] = [];
    const files = roots.filter((r): r is FileSystemFileHandle => r.kind === "file");
    for (const r of roots) if (r.kind === "directory") inputs.push({ kind: "dir", handle: r as FileSystemDirectoryHandle });
    if (files.length) inputs.push({ kind: "handles", handles: files });
    await getState().importFrom(inputs);
  },

  async importFrom(inputs, append = false) {
    const previous = append ? getState().sources : [];
    setState({ status: "loading", error: null, progress: { label: t.scanning, found: 0 } });
    try {
      const sources = [...previous];
      for (const input of inputs) {
        const base = sources.length;
        sources.push(
          ...(await scan(input, (p) =>
            setState({ progress: { label: t.scanning, found: base + p.found, current: p.current } }),
          )),
        );
      }
      const memories = await buildMemories(sources, (p) =>
        setState({
          progress: { label: p.step === "exif" ? t.exif : t.analyzing, done: p.done, total: p.total },
        }),
      );
      if (!memories.length) {
        setState({ status: append ? "ready" : "idle", progress: null, error: t.noMedia });
        return;
      }
      const roots = rootsOf(inputs);
      if (roots.length) {
        const kept = append ? getState().savedRoots : [];
        const all = [...kept, ...roots];
        setState({ savedRoots: all });
        set(ROOTS_KEY, all).catch(() => {});
      } else if (!append) {
        setState({ savedRoots: [] });
        del(ROOTS_KEY).catch(() => {});
      }
      setState({ status: "ready", progress: null, memories, sources });
    } catch (err) {
      console.error(err);
      if ((err as DOMException)?.name === "AbortError") {
        setState({ status: append ? "ready" : "idle", progress: null });
        return;
      }
      setState({ status: append ? "ready" : "idle", progress: null, error: String((err as Error)?.message ?? err) });
    }
  },

  async closeLibrary() {
    resetMediaCache();
    await del(ROOTS_KEY).catch(() => {});
    setState({ status: "idle", memories: [], sources: [], savedRoots: [], viewer: null, filter: "all" });
  },

  setFilter(filter) {
    setState({ filter });
  },
  openViewer(list, index, story = false) {
    setState({ viewer: { list, index, story } });
  },
  setViewerIndex(index) {
    const v = getState().viewer;
    if (v) setState({ viewer: { ...v, index } });
  },
  closeViewer() {
    setState({ viewer: null });
  },
}));
