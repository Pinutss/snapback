import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmt, t } from "../lib/i18n";

export interface Mark {
  /** Absolute document Y of the month header. */
  y: number;
  year: number;
  month: number;
}

interface Props {
  marks: Mark[];
  /** Height of the sticky header: content above it is hidden. */
  top: number;
}

const HANDLE = 44;
const HIDE_AFTER = 1300;

const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Snapchat-style fast scroller: a yellow handle on the right edge that you drag
 * through the years, with a bubble telling you where you are.
 */
export function YearScrubber({ marks, top }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const [railH, setRailH] = useState(0);
  const [p, setP] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef<number>(0);
  const lastYear = useRef<number | null>(null);

  const show = useCallback(() => {
    setVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_AFTER);
  }, []);

  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRailH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow the page scroll.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setP(clamp01(window.scrollY / maxScroll()));
        show();
      });
    };
    const onMove = (e: MouseEvent) => {
      if (e.clientX > window.innerWidth - 80) show();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("mousemove", onMove);
    };
  }, [show]);

  // Which month is at the top of the viewport?
  const current = useMemo(() => {
    if (!marks.length) return null;
    const y = p * maxScroll() + top + 4;
    let lo = 0;
    let hi = marks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid].y <= y) lo = mid;
      else hi = mid - 1;
    }
    return marks[lo];
  }, [p, marks, top]);

  // A little tick when you cross a year while dragging.
  useEffect(() => {
    if (!current) return;
    if (dragging && lastYear.current !== null && lastYear.current !== current.year) navigator.vibrate?.(8);
    lastYear.current = current.year;
  }, [current, dragging]);

  const track = Math.max(1, railH - HANDLE);

  // Year labels along the rail, skipping those that would overlap.
  const years = useMemo(() => {
    const out: { year: number; y: number; idx: number }[] = [];
    const max = maxScroll();
    let last = -Infinity;
    marks.forEach((m, idx) => {
      if (idx > 0 && marks[idx - 1].year === m.year) return;
      const y = clamp01((m.y - top) / max) * track + HANDLE / 2;
      if (y - last < 22) return;
      last = y;
      out.push({ year: m.year, y, idx });
    });
    return out;
  }, [marks, top, track]);

  const scrollToP = (np: number) => window.scrollTo({ top: clamp01(np) * maxScroll(), behavior: "instant" });

  const fromPointer = (clientY: number) => {
    const rect = railRef.current!.getBoundingClientRect();
    scrollToP((clientY - rect.top - HANDLE / 2) / track);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    show();
    fromPointer(e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    show();
    fromPointer(e.clientY);
  };
  const onPointerUp = () => {
    setDragging(false);
    show();
  };

  const jumpTo = (m: Mark | undefined) => {
    if (m) window.scrollTo({ top: Math.max(0, m.y - top), behavior: "instant" });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!current) return;
    const i = marks.indexOf(current);
    const yearStart = (dir: 1 | -1) => {
      for (let k = i + dir; k >= 0 && k < marks.length; k += dir) {
        if (marks[k].year !== current.year && (dir > 0 || k === 0 || marks[k - 1].year !== marks[k].year)) return marks[k];
      }
      return undefined;
    };
    const actions: Record<string, () => void> = {
      ArrowDown: () => jumpTo(marks[i + 1]),
      ArrowUp: () => jumpTo(marks[Math.max(0, i - 1)]),
      PageDown: () => jumpTo(yearStart(1)),
      PageUp: () => jumpTo(yearStart(-1)),
      Home: () => scrollToP(0),
      End: () => scrollToP(1),
    };
    const fn = actions[e.key];
    if (fn) {
      e.preventDefault();
      fn();
      show();
    }
  };

  if (!marks.length) return null;
  const handleY = p * track;
  const label = current ? fmt.monthYear(current.year, current.month) : "";

  return (
    <div
      className="scrubber"
      style={{ top: top + 12 }}
      data-visible={visible || dragging}
      data-dragging={dragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="scrubber-rail" ref={railRef} />
      {years.map((y) => (
        <span key={y.year} className={`scrubber-year${current?.year === y.year ? " active" : ""}`} style={{ top: y.y }}>
          {y.year}
        </span>
      ))}
      <div
        className="scrubber-handle"
        style={{ top: handleY }}
        role="slider"
        tabIndex={0}
        aria-label={t.scrubber}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p * 100)}
        aria-valuetext={label}
        onKeyDown={onKeyDown}
        onFocus={show}
      />
      <AnimatePresence>
        {dragging && current && (
          <motion.div
            className="scrubber-bubble"
            style={{ top: handleY + HANDLE / 2 }}
            initial={{ opacity: 0, x: 16, scale: 0.85 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16, scale: 0.85 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
          >
            {fmt.month(current.year, current.month)}{" "}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.b
                key={current.year}
                style={{ display: "inline-block" }}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ type: "spring", stiffness: 600, damping: 30 }}
              >
                {current.year}
              </motion.b>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
