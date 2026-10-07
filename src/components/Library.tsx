import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmt, t } from "../lib/i18n";
import { clearThumbCache } from "../lib/thumbs";
import type { Memory } from "../lib/types";
import { useStore, type Filter } from "../store";
import { Flashback } from "./Flashback";
import { IconInstall, IconLogout, IconMore, IconPlus, IconTrash, Logo } from "./Icons";
import { InstallButton } from "./Install";
import { Thumb } from "./Thumb";
import { useImporter } from "./useImporter";
import { YearScrubber, type Mark } from "./YearScrubber";

type Row =
  | { type: "header"; key: string; year: number; month: number; count: number }
  | { type: "items"; key: string; items: Memory[] };

const HEADER_H = 64;
const TILE_RATIO = 3 / 2; // portrait tiles, height = width * 1.5

function columnsFor(width: number) {
  if (width < 560) return 3;
  if (width < 860) return 4;
  if (width < 1180) return 5;
  return 6;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Tabs() {
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const tabs: [Filter, string][] = [
    ["all", t.all],
    ["photo", t.photos],
    ["video", t.videos],
  ];
  return (
    <div className="segmented" role="group">
      {tabs.map(([value, label]) => (
        <button
          key={value}
          aria-pressed={filter === value}
          onClick={() => {
            setFilter(value);
            window.scrollTo({ top: 0 });
          }}
        >
          {filter === value && (
            <motion.span
              layoutId="tab-pill"
              className="pill"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function HeaderMenu({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const closeLibrary = useStore((s) => s.closeLibrary);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="lib-actions" ref={ref}>
      <InstallButton className="icon-btn" label={t.install}>
        <IconInstall />
      </InstallButton>
      <button className="icon-btn" onClick={onAdd} aria-label={t.addMore} title={t.addMore}>
        <IconPlus />
      </button>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
        <IconMore />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16 }}
            style={{ transformOrigin: "top right" }}
          >
            <button
              onClick={async () => {
                setOpen(false);
                await clearThumbCache();
                location.reload();
              }}
            >
              <IconTrash />
              {t.clearCache}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                closeLibrary();
              }}
            >
              <IconLogout />
              {t.closeLibrary}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Library() {
  const memories = useStore((s) => s.memories);
  const filter = useStore((s) => s.filter);
  const openViewer = useStore((s) => s.openViewer);
  const { pickFolder, dragging } = useImporter({ append: true });

  const filtered = useMemo(
    () => (filter === "all" ? memories : memories.filter((m) => m.kind === filter)),
    [memories, filter],
  );

  const [bodyRef, width] = useElementWidth<HTMLDivElement>();
  const cols = columnsFor(width);
  const gap = width < 560 ? 3 : 6;
  const tileW = width ? (width - gap * (cols - 1)) / cols : 0;
  const rowH = Math.round(tileW * TILE_RATIO) + gap;

  // Month headers + rows of tiles.
  const { rows, rowOf } = useMemo(() => {
    const rows: Row[] = [];
    const rowOf = new Map<string, number>();
    let i = 0;
    while (i < filtered.length) {
      const d = new Date(filtered[i].date);
      const year = d.getFullYear();
      const month = d.getMonth();
      let j = i;
      while (j < filtered.length) {
        const dj = new Date(filtered[j].date);
        if (dj.getFullYear() !== year || dj.getMonth() !== month) break;
        j++;
      }
      rows.push({ type: "header", key: `h${year}-${month}`, year, month, count: j - i });
      for (let k = i; k < j; k += cols) {
        const items = filtered.slice(k, Math.min(k + cols, j));
        for (const m of items) rowOf.set(m.key, rows.length);
        rows.push({ type: "items", key: items[0].key, items });
      }
      i = j;
    }
    return { rows, rowOf };
  }, [filtered, cols]);

  // Where the list starts in the page (flashbacks sit above it).
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (listRef.current) setScrollMargin(listRef.current.getBoundingClientRect().top + window.scrollY);
      if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (bodyRef.current) ro.observe(bodyRef.current);
    if (headerRef.current) ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, [bodyRef]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i].type === "header" ? HEADER_H : rowH),
    getItemKey: (i) => rows[i].key,
    overscan: 4,
    scrollMargin,
  });

  // Sizes are deterministic: reset the cache whenever the layout changes.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rows, rowH]);

  const marks: Mark[] = useMemo(() => {
    const out: Mark[] = [];
    let y = scrollMargin;
    for (const r of rows) {
      if (r.type === "header") out.push({ y, year: r.year, month: r.month });
      y += r.type === "header" ? HEADER_H : rowH;
    }
    return out;
  }, [rows, rowH, scrollMargin]);

  // Keep the grid behind the viewer in sync, so closing zooms back into the right tile.
  const viewerKey = useStore((s) => (s.viewer && !s.viewer.story ? s.viewer.list[s.viewer.index]?.key : undefined));
  useEffect(() => {
    if (!viewerKey) return;
    const row = rowOf.get(viewerKey);
    if (row == null) return;
    const item = virtualizer.getVirtualItems().find((v) => v.index === row);
    // `start`/`end` already include the scroll margin.
    const visible =
      item && item.start >= window.scrollY + headerH && item.end <= window.scrollY + window.innerHeight;
    if (!visible) virtualizer.scrollToIndex(row, { align: "center" });
  }, [viewerKey, rowOf, virtualizer, headerH]);

  const onOpen = useCallback(
    (m: Memory) => {
      const index = filtered.indexOf(m);
      if (index >= 0) openViewer(filtered, index);
    },
    [filtered, openViewer],
  );

  const years = useMemo(() => {
    if (!memories.length) return "";
    const a = new Date(memories[memories.length - 1].date).getFullYear();
    const b = new Date(memories[0].date).getFullYear();
    return a === b ? `${a}` : `${a} – ${b}`;
  }, [memories]);

  return (
    <>
      <header className="lib-header" ref={headerRef}>
        <div className="lib-header-row">
          <div className="lib-title">
            <Logo />
            <div>
              <h1>{t.memories}</h1>
              <small>
                {t.count(memories.length)} · {years}
              </small>
            </div>
          </div>
          <HeaderMenu onAdd={pickFolder} />
        </div>
        <div className="tabs">
          <Tabs />
        </div>
      </header>

      <div className="lib-body" ref={bodyRef}>
        {filter === "all" && <Flashback memories={memories} />}

        <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {width > 0 &&
            virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index];
              return (
                <div
                  key={v.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: v.size,
                    transform: `translateY(${v.start - scrollMargin}px)`,
                  }}
                >
                  {row.type === "header" ? (
                    <div className="month-header">
                      <h3>{fmt.monthYear(row.year, row.month)}</h3>
                      <span>{row.count}</span>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                        gap,
                        height: rowH - gap,
                      }}
                    >
                      {row.items.map((m) => (
                        <Thumb key={m.key} memory={m} onOpen={onOpen} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        {!filtered.length && <div className="empty">{t.empty}</div>}
      </div>

      <YearScrubber marks={marks} top={headerH} />

      <AnimatePresence>
        {dragging && (
          <motion.div
            className="drop-veil"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18 }}
          >
            {t.dropNow}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
