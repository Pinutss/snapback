import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, type ImportInput } from "../store";

const isAbort = (e: unknown) => (e as DOMException)?.name === "AbortError";

function pickWithInput(opts: { directory: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (opts.directory) input.webkitdirectory = true;
    else input.accept = ".zip,.json,image/*,video/*";
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Folder / zip pickers + window-wide drag & drop, shared by the landing page and the library. */
export function useImporter({ append }: { append: boolean }) {
  const importFrom = useStore((s) => s.importFrom);

  const run = useCallback((inputs: ImportInput[]) => (inputs.length ? importFrom(inputs, append) : undefined), [
    importFrom,
    append,
  ]);

  const pickFolder = useCallback(async () => {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({ id: "snapback", mode: "read" });
        return run([{ kind: "dir", handle }]);
      } catch (e) {
        if (isAbort(e)) return;
        console.warn(e);
      }
    }
    const files = await pickWithInput({ directory: true });
    return run(files.length ? [{ kind: "files", files }] : []);
  }, [run]);

  const pickFiles = useCallback(async () => {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({
          id: "snapback-zip",
          multiple: true,
          types: [
            {
              description: "Snapchat export",
              accept: {
                "application/zip": [".zip"],
                "application/json": [".json"],
                "image/*": [".jpg", ".jpeg", ".png", ".webp", ".heic"],
                "video/*": [".mp4", ".mov", ".webm"],
              },
            },
          ],
        });
        return run([{ kind: "handles", handles }]);
      } catch (e) {
        if (isAbort(e)) return;
        console.warn(e);
      }
    }
    const files = await pickWithInput({ directory: false });
    return run(files.length ? [{ kind: "files", files }] : []);
  }, [run]);

  // Drag & drop anywhere on the page.
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const items = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === "file");
      // Must be read synchronously, the DataTransfer is emptied after this handler.
      if (items.length && items[0].getAsFileSystemHandle) {
        const pending = items.map((i) => i.getAsFileSystemHandle!());
        Promise.all(pending).then((handles) => {
          const inputs: ImportInput[] = [];
          const files: FileSystemFileHandle[] = [];
          for (const h of handles) {
            if (!h) continue;
            if (h.kind === "directory") inputs.push({ kind: "dir", handle: h as FileSystemDirectoryHandle });
            else files.push(h as FileSystemFileHandle);
          }
          if (files.length) inputs.push({ kind: "handles", handles: files });
          run(inputs);
        });
        return;
      }
      const entries = items.map((i) => i.webkitGetAsEntry()).filter((x): x is FileSystemEntry => !!x);
      if (entries.length) run([{ kind: "entries", entries }]);
      else run([{ kind: "files", files: Array.from(e.dataTransfer?.files ?? []) }]);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [run]);

  return { pickFolder, pickFiles, dragging };
}
