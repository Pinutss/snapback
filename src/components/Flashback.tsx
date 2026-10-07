import { motion } from "motion/react";
import { useMemo } from "react";
import { t } from "../lib/i18n";
import type { Memory } from "../lib/types";
import { useStore } from "../store";
import { useThumb } from "./Thumb";

interface Group {
  yearsAgo: number;
  items: Memory[];
}

const DAY = 86_400_000;

/** Memories from today's date in previous years (or, failing that, the same week). */
export function useFlashbacks(memories: Memory[]): { title: string; groups: Group[] } {
  return useMemo(() => {
    const now = new Date();
    const thisYear = now.getFullYear();
    const pick = (windowDays: number) => {
      const byYear = new Map<number, Memory[]>();
      for (const m of memories) {
        const d = new Date(m.date);
        const y = d.getFullYear();
        if (y >= thisYear) continue;
        const anniversary = new Date(y, now.getMonth(), now.getDate()).getTime();
        const dayStart = new Date(y, d.getMonth(), d.getDate()).getTime();
        if (Math.abs(dayStart - anniversary) > windowDays * DAY) continue;
        byYear.set(y, [...(byYear.get(y) ?? []), m]);
      }
      return [...byYear.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([y, items]) => ({ yearsAgo: thisYear - y, items: items.sort((a, b) => a.date - b.date) }));
    };
    const today = pick(0);
    if (today.length) return { title: t.onThisDay, groups: today };
    return { title: t.flashback, groups: pick(3) };
  }, [memories]);
}

function Bubble({ group, i }: { group: Group; i: number }) {
  const openViewer = useStore((s) => s.openViewer);
  const cover = group.items[0];
  const { thumb } = useThumb(cover);
  return (
    <motion.button
      className="bubble"
      onClick={() => openViewer(group.items, 0, true)}
      initial={{ opacity: 0, scale: 0.6, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.05 * i }}
      whileTap={{ scale: 0.92 }}
    >
      <div className="bubble-ring">
        <div data-key={cover.key}>{thumb && <img src={thumb.url} alt="" draggable={false} />}</div>
      </div>
      <small>{t.yearsAgo(group.yearsAgo)}</small>
    </motion.button>
  );
}

export function Flashback({ memories }: { memories: Memory[] }) {
  const { title, groups } = useFlashbacks(memories);
  if (!groups.length) return null;
  return (
    <section className="flashback">
      <h2>{title}</h2>
      <div className="flashback-row">
        {groups.map((g, i) => (
          <Bubble key={g.yearsAgo} group={g} i={i} />
        ))}
      </div>
    </section>
  );
}
