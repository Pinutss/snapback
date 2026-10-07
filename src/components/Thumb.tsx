import { memo, useEffect, useState } from "react";
import { fmt } from "../lib/i18n";
import { peekThumb, requestThumb, type Thumb as ThumbData } from "../lib/thumbs";
import type { Memory } from "../lib/types";
import { IconImageOff, IconPlay } from "./Icons";

/** Loads (or generates) a memory thumbnail while it is on screen. */
export function useThumb(memory: Memory | undefined) {
  const [thumb, setThumb] = useState<ThumbData | undefined>(() => (memory ? peekThumb(memory) : undefined));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!memory) return;
    const cached = peekThumb(memory);
    if (cached) {
      setThumb(cached);
      return;
    }
    setThumb(undefined);
    setFailed(false);
    const ac = new AbortController();
    requestThumb(memory, ac.signal).then(
      (t) => !ac.signal.aborted && setThumb(t),
      (e) => {
        if (!ac.signal.aborted && e?.name !== "AbortError") setFailed(true);
      },
    );
    return () => ac.abort();
  }, [memory]);
  return { thumb, failed };
}

interface Props {
  memory: Memory;
  onOpen: (memory: Memory) => void;
}

export const Thumb = memo(function Thumb({ memory, onOpen }: Props) {
  const { thumb, failed } = useThumb(memory);
  // Cached thumbnails appear instantly, fresh ones fade in.
  const [loaded, setLoaded] = useState(() => !!peekThumb(memory));
  const label = `${memory.kind === "video" ? "Video" : "Photo"} · ${fmt.day(memory.date)}`;

  return (
    <button className="tile" data-key={memory.key} onClick={() => onOpen(memory)} aria-label={label}>
      {!loaded && !failed && <div className="shimmer" />}
      {thumb && (
        <img
          src={thumb.url}
          alt=""
          decoding="async"
          draggable={false}
          className={loaded ? "loaded" : undefined}
          onLoad={() => setLoaded(true)}
        />
      )}
      {failed && (
        <div className="tile-broken">
          <IconImageOff />
        </div>
      )}
      {memory.kind === "video" && (
        <span className="tile-badge">
          <IconPlay />
          {thumb?.duration ? fmt.duration(thumb.duration) : null}
        </span>
      )}
    </button>
  );
});
