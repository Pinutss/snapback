import { motion } from "motion/react";
import { t } from "../lib/i18n";
import type { Progress } from "../store";
import { Logo } from "./Icons";

export function Loading({ progress }: { progress: Progress }) {
  const hasTotal = progress.total != null && progress.total > 0;
  const pct = hasTotal ? Math.min(100, (100 * (progress.done ?? 0)) / progress.total!) : 0;
  const big = hasTotal ? `${Math.round(pct)}%` : (progress.found ?? 0).toLocaleString();
  return (
    <motion.div
      className="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      role="status"
      aria-live="polite"
    >
      <div className="loading-inner">
        <motion.div
          className="loading-mark"
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
        >
          <Logo style={{ width: "100%", height: "100%" }} />
        </motion.div>
        <div className="loading-count">{big}</div>
        <div className="loading-label">
          {progress.label}
          {!hasTotal && ` · ${t.filesFound}`}
        </div>
        <div className={`loading-bar${hasTotal ? "" : " indeterminate"}`}>
          <div style={hasTotal ? { width: `${pct}%` } : undefined} />
        </div>
        <div className="loading-current">{progress.current || "\u00a0"}</div>
      </div>
    </motion.div>
  );
}
