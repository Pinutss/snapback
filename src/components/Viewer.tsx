import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmt, t } from "../lib/i18n";
import { mediaUrl } from "../lib/thumbs";
import type { Memory } from "../lib/types";
import { useStore, type ViewerState } from "../store";
import { IconChevron, IconClose, IconDownload, IconPause, IconPin, IconText, IconVolume } from "./Icons";

const PHOTO_MS = 5000;
let mutedPref = false;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

function tileRect(key: string): DOMRect | null {
  const sel = CSS.escape(key);
  const el = document.querySelector(`.tile[data-key="${sel}"]`) ?? document.querySelector(`[data-key="${sel}"]`);
  const r = el?.getBoundingClientRect();
  if (!r || r.bottom < 0 || r.top > window.innerHeight) return null;
  return r;
}

function yearsAgo(date: number) {
  const now = new Date();
  const d = new Date(date);
  let n = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) n--;
  return n;
}

async function download(memory: Memory, withOverlay: boolean) {
  let blob = await memory.main.getBlob();
  let name = memory.main.name;
  if (withOverlay && memory.overlay && memory.kind === "photo") {
    const [base, ov] = await Promise.all([
      createImageBitmap(blob),
      memory.overlay.getBlob().then((b) => createImageBitmap(b)),
    ]);
    const c = document.createElement("canvas");
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(ov, 0, 0, base.width, base.height);
    base.close();
    ov.close();
    blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.93));
    name = name.replace(/(-main)?\.[^.]+$/i, "") + "-snapback.jpg";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ------------------------------------------------------------------ */
/* One memory                                                          */
/* ------------------------------------------------------------------ */

interface MediaProps {
  onWidth: (w: number) => void;
  memory: Memory;
  paused: boolean;
  muted: boolean;
  showOverlay: boolean;
  story: boolean;
  onProgress: (p: number) => void;
  onEnded: () => void;
  onAutoMute: () => void;
}

function Media({ onWidth, memory, paused, muted, showOverlay, story, onProgress, onEnded, onAutoMute }: MediaProps) {
  const vp = useViewport();
  const [src, setSrc] = useState<string>();
  const [overlaySrc, setOverlaySrc] = useState<string>();
  const [size, setSize] = useState<{ w: number; h: number }>();
  const [error, setError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    let alive = true;
    mediaUrl(memory.main).then((u) => alive && setSrc(u), () => alive && setError(true));
    if (memory.overlay) mediaUrl(memory.overlay).then((u) => alive && setOverlaySrc(u), () => {});
    return () => {
      alive = false;
    };
  }, [memory]);

  // Play / pause / mute.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.muted = muted;
    if (paused) v.pause();
    else
      v.play().catch((e: DOMException) => {
        // Autoplay with sound refused: retry muted, like Snapchat on the web.
        if (e.name === "NotAllowedError" && !v.muted) {
          onAutoMute();
          v.muted = true;
          v.play().catch(() => {});
        }
      });
  }, [paused, muted, src, onAutoMute]);

  // Progress: video time, or a 5 s timer for photos in story mode.
  useEffect(() => {
    if (!src) return;
    let raf = 0;
    if (memory.kind === "video") {
      const loop = () => {
        const v = videoRef.current;
        if (v && v.duration) onProgress(v.currentTime / v.duration);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }
    if (!story || paused) return;
    let last = performance.now();
    let elapsed = elapsedRef.current;
    const loop = (now: number) => {
      elapsed += now - last;
      last = now;
      elapsedRef.current = elapsed;
      onProgress(Math.min(1, elapsed / PHOTO_MS));
      if (elapsed >= PHOTO_MS) onEnded();
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [src, memory.kind, story, paused, onProgress, onEnded]);

  // Contain-fit box, so the overlay lines up exactly with the media.
  const nat = size ?? { w: 9, h: 16 };
  const pad = vp.w >= 700 ? 24 : 0;
  const fit = Math.min((vp.w - pad * 2) / nat.w, (vp.h - pad * 2) / nat.h);
  const box = { width: Math.round(nat.w * fit), height: Math.round(nat.h * fit) };
  useEffect(() => onWidth(box.width), [box.width, onWidth]);

  return (
    <div className="viewer-media" style={box}>
      {src && memory.kind === "photo" && (
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setError(true)}
        />
      )}
      {src && memory.kind === "video" && (
        <video
          ref={videoRef}
          src={src}
          playsInline
          loop={!story}
          muted={muted}
          onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth || 9, h: e.currentTarget.videoHeight || 16 })}
          onEnded={story ? onEnded : undefined}
          onError={() => setError(true)}
        />
      )}
      {overlaySrc && (
        <img className="overlay-layer" src={overlaySrc} alt="" draggable={false} style={{ opacity: showOverlay ? 1 : 0 }} />
      )}
      {!size && !error && (
        <div className="viewer-loading">
          <div className="spinner" />
        </div>
      )}
      {error && <div className="viewer-error">{t.notSupported}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Viewer                                                              */
/* ------------------------------------------------------------------ */

const slide = {
  enter: (dir: number) => ({ x: dir >= 0 ? "45%" : "-45%", opacity: 0, scale: 0.94 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? "-45%" : "45%", opacity: 0, scale: 0.94 }),
};

function ViewerInner({ list, index, story }: ViewerState) {
  const setIndex = useStore((s) => s.setViewerIndex);
  const close = useStore((s) => s.closeViewer);
  const memory = list[index];
  const vp = useViewport();

  const [dir, setDir] = useState(1);
  const [held, setHeld] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [muted, setMuted] = useState(mutedPref);
  const [showOverlay, setShowOverlay] = useState(true);
  const [progress, setProgress] = useState(0);
  const [mediaW, setMediaW] = useState(0);
  const paused = held || userPaused;

  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const backdrop = useTransform(dragY, [0, 400], [1, 0.15]);
  const dragScale = useTransform(dragY, [0, 600], [1, 0.75]);

  // Zoom from / back into the tile.
  const [origin] = useState(() => tileRect(memory.key));
  const fromTile = (r: DOMRect | null) =>
    r
      ? {
          x: r.left + r.width / 2 - vp.w / 2,
          y: r.top + r.height / 2 - vp.h / 2,
          scale: Math.max(0.15, r.height / vp.h),
          opacity: 0,
        }
      : { scale: 0.92, opacity: 0, x: 0, y: 40 };
  const exitTarget = fromTile(tileRect(memory.key));

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0) return;
      if (next >= list.length) {
        if (story) close();
        return;
      }
      setDir(delta);
      setProgress(0);
      setUserPaused(false);
      setIndex(next);
    },
    [index, list.length, story, close, setIndex],
  );
  const next = useCallback(() => go(1), [go]);

  // Preload neighbours so swiping feels instant.
  useEffect(() => {
    for (const m of [list[index + 1], list[index - 1]]) {
      if (m?.kind === "photo") {
        mediaUrl(m.main).catch(() => {});
        if (m.overlay) mediaUrl(m.overlay).catch(() => {});
      }
    }
  }, [list, index]);

  // Lock page scroll.
  useLayoutEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setUserPaused((p) => !p);
      } else if (e.key.toLowerCase() === "m") toggleMute();
      else if (e.key.toLowerCase() === "t") setShowOverlay((s) => !s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleMute = () =>
    setMuted((m) => {
      mutedPref = !m;
      return !m;
    });
  const onAutoMute = useCallback(() => {
    mutedPref = true;
    setMuted(true);
  }, []);

  // Gestures: tap left/right, swipe sideways, drag down to dismiss, hold to pause.
  const gesture = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null; hold: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      axis: null,
      hold: window.setTimeout(() => setHeld(true), 220),
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.axis && Math.hypot(dx, dy) > 10) {
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      clearTimeout(g.hold);
      setHeld(false);
    }
    if (g.axis === "y") dragY.set(dy > 0 ? dy : dy * 0.15);
    if (g.axis === "x") {
      const edge = (dx > 0 && index === 0) || (dx < 0 && index === list.length - 1);
      dragX.set(edge ? dx * 0.25 : dx);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    clearTimeout(g.hold);
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const dt = performance.now() - g.t;
    if (held) {
      setHeld(false);
      return;
    }
    if (g.axis === "y") {
      if (dy > 140 || (dy > 50 && dy / dt > 0.6)) {
        animate(dragY, 0, { duration: 0.3 });
        close();
      }
      else animate(dragY, 0, { type: "spring", stiffness: 400, damping: 35 });
      return;
    }
    if (g.axis === "x") {
      if (Math.abs(dx) > 70 || Math.abs(dx) / dt > 0.5) go(dx < 0 ? 1 : -1);
      animate(dragX, 0, { type: "spring", stiffness: 400, damping: 38 });
      return;
    }
    if (dt < 300) {
      if (e.clientX < vp.w * 0.3) go(-1);
      else go(1);
    }
  };

  const ago = yearsAgo(memory.date);
  const many = list.length > 40;

  return (
    <motion.div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={fmt.full(memory.date)}
      initial={{ opacity: 1 }}
      exit={{ opacity: 1 }}
    >
      <motion.div
        className="viewer-backdrop"
        style={{ opacity: backdrop }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      />

      <motion.div
        className="viewer-stage"
        initial={fromTile(origin)}
        animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
        exit={exitTarget}
        transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <motion.div style={{ x: dragX, y: dragY, scale: dragScale, display: "grid", placeItems: "center" }}>
          <AnimatePresence initial={false} custom={dir}>
            <motion.div
              key={memory.key}
              custom={dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              style={{ gridArea: "1 / 1" }}
            >
              <Media
                memory={memory}
                paused={paused}
                muted={muted}
                showOverlay={showOverlay}
                story={story}
                onProgress={setProgress}
                onEnded={next}
                onAutoMute={onAutoMute}
                onWidth={setMediaW}
              />
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <AnimatePresence>
          {paused && (
            <motion.div
              className="paused-hint"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <div>
                <IconPause />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <motion.div
        className="viewer-top"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="viewer-top-inner" style={mediaW ? { maxWidth: mediaW } : undefined}>
          {(story || memory.kind === "video") && (
            <div className="segments" aria-hidden>
              {story && !many ? (
                list.map((m, i) => (
                  <div key={m.key}>
                    <i style={{ transform: `scaleX(${i < index ? 1 : i === index ? progress : 0})` }} />
                  </div>
                ))
              ) : (
                <div>
                  <i style={{ transform: `scaleX(${progress})` }} />
                </div>
              )}
            </div>
          )}
          <div className="viewer-meta">
            <div className="viewer-date">
              <strong>{fmt.full(memory.date)}</strong>
              <span>
                {memory.dateSource === "json" || memory.dateSource === "exif"
                  ? fmt.time(memory.date)
                  : memory.dateSource === "file" && t.dateApprox}
                {ago > 0 && <span>{t.yearsAgo(ago)}</span>}
                {memory.location && (
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${memory.location.lat}&mlon=${memory.location.lon}#map=15/${memory.location.lat}/${memory.location.lon}`}
                    target="_blank"
                    rel="noreferrer"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <IconPin />
                    {t.openMap}
                  </a>
                )}
              </span>
            </div>
            <div className="viewer-buttons" onPointerDown={(e) => e.stopPropagation()}>
              {memory.overlay && (
                <button
                  className="viewer-btn"
                  aria-pressed={showOverlay}
                  onClick={() => setShowOverlay((s) => !s)}
                  aria-label={showOverlay ? t.overlayOn : t.overlayOff}
                  title={showOverlay ? t.overlayOn : t.overlayOff}
                >
                  <IconText />
                </button>
              )}
              {memory.kind === "video" && (
                <button
                  className="viewer-btn"
                  onClick={toggleMute}
                  aria-label={muted ? t.unmute : t.mute}
                  title={muted ? t.unmute : t.mute}
                >
                  <IconVolume muted={muted} />
                </button>
              )}
              <button
                className="viewer-btn"
                onClick={() => download(memory, showOverlay).catch(console.error)}
                aria-label={memory.overlay && showOverlay && memory.kind === "photo" ? t.downloadWithOverlay : t.download}
                title={memory.overlay && showOverlay && memory.kind === "photo" ? t.downloadWithOverlay : t.download}
              >
                <IconDownload />
              </button>
              <button className="viewer-btn" onClick={close} aria-label={t.close} title={t.close}>
                <IconClose />
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      <button className="viewer-nav prev" onClick={() => go(-1)} disabled={index === 0} aria-label={t.previous}>
        <IconChevron dir="left" />
      </button>
      <button
        className="viewer-nav next"
        onClick={() => go(1)}
        disabled={index === list.length - 1 && !story}
        aria-label={t.next}
      >
        <IconChevron dir="right" />
      </button>

      {!story && (
        <motion.div className="viewer-bottom" initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} exit={{ opacity: 0 }}>
          {(index + 1).toLocaleString()} / {list.length.toLocaleString()}
        </motion.div>
      )}
    </motion.div>
  );
}

export function Viewer() {
  const viewer = useStore((s) => s.viewer);
  return <AnimatePresence>{viewer && <ViewerInner key="viewer" {...viewer} />}</AnimatePresence>;
}
