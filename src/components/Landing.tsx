import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { REPO_URL } from "../config";
import { t } from "../lib/i18n";
import { useStore } from "../store";
import { IconFolder, IconGithub, IconZip, Logo } from "./Icons";
import { InstallButton } from "./Install";
import { useImporter } from "./useImporter";

const TILE_COLORS = [
  "linear-gradient(160deg,#ff9a8b,#ff6a88)",
  "linear-gradient(160deg,#89f7fe,#66a6ff)",
  "linear-gradient(160deg,#fddb92,#d1fdff)",
  "linear-gradient(160deg,#c2e9fb,#a1c4fd)",
  "linear-gradient(160deg,#f6d365,#fda085)",
  "linear-gradient(160deg,#a8edea,#fed6e3)",
  "linear-gradient(160deg,#84fab0,#8fd3f4)",
  "linear-gradient(160deg,#fbc2eb,#a6c1ee)",
  "linear-gradient(160deg,#ffecd2,#fcb69f)",
  "linear-gradient(160deg,#30cfd0,#330867)",
  "linear-gradient(160deg,#5ee7df,#b490ca)",
  "linear-gradient(160deg,#e0c3fc,#8ec5fc)",
];

const PREVIEW_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

function Preview() {
  const [i, setI] = useState(4);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % PREVIEW_YEARS.length), 1400);
    return () => clearInterval(id);
  }, []);
  const col = (offset: number) => {
    const tiles = Array.from({ length: 8 }, (_, k) => TILE_COLORS[(k * 3 + offset) % TILE_COLORS.length]);
    // Duplicated so the -50% keyframe loops seamlessly.
    return [...tiles, ...tiles].map((bg, k) => <div key={k} className="preview-tile" style={{ background: bg }} />);
  };
  return (
    <motion.div
      className="preview"
      aria-hidden
      initial={{ opacity: 0, y: 60, rotate: 8 }}
      animate={{ opacity: 1, y: 0, rotate: 3 }}
      transition={{ type: "spring", stiffness: 70, damping: 16, delay: 0.15 }}
    >
      <div className="preview-cols">
        <div className="preview-col">{col(0)}</div>
        <div className="preview-col">{col(5)}</div>
        <div className="preview-col">{col(9)}</div>
      </div>
      <div className="preview-scrub">
        <div className="preview-thumb" />
      </div>
      <div className="preview-bubble">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={PREVIEW_YEARS[i]}
            style={{ display: "inline-block" }}
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -18, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {PREVIEW_YEARS[i]}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

const rise = {
  hidden: { opacity: 0, y: 28 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 120, damping: 18, delay: 0.06 * i },
  }),
};

export function Landing() {
  const { pickFolder, pickFiles, dragging } = useImporter({ append: false });
  const savedRoots = useStore((s) => s.savedRoots);
  const resume = useStore((s) => s.resume);
  const error = useStore((s) => s.error);
  const canPersist = typeof window !== "undefined" && !!window.showDirectoryPicker;

  return (
    <div className="landing">
      <header className="landing-top">
        <span className="brand">
          <Logo />
          Snapback
        </span>
        <div className="landing-links">
          <InstallButton className="gh install" />
          <a className="gh" href={REPO_URL} target="_blank" rel="noreferrer" aria-label={t.source}>
            <IconGithub />
            <span>{t.source}</span>
          </a>
        </div>
      </header>

      <main className="landing-main">
        <div className="hero">
          <motion.h1 variants={rise} initial="hidden" animate="show" custom={0}>
            {t.heroTitle}
          </motion.h1>
          <motion.p variants={rise} initial="hidden" animate="show" custom={1}>
            {t.heroText}
          </motion.p>
          <motion.div className="hero-actions" variants={rise} initial="hidden" animate="show" custom={2}>
            {savedRoots.length > 0 && (
              <button className="btn btn-dark" onClick={resume}>
                <Logo style={{ width: 22, height: 22 }} />
                {t.resume}
              </button>
            )}
            <button className={savedRoots.length ? "btn btn-ghost" : "btn btn-dark"} onClick={pickFolder}>
              <IconFolder />
              {t.pickFolder}
            </button>
            <button className="btn btn-ghost" onClick={pickFiles}>
              <IconZip />
              {t.pickZip}
            </button>
          </motion.div>
          <motion.div variants={rise} initial="hidden" animate="show" custom={3}>
            <div className="hero-hint">{t.dropHint}</div>
            {error && <div className="hero-error" role="alert">{error}</div>}
            {!canPersist && <div className="hero-note">{t.unsupportedPersist}</div>}
          </motion.div>
        </div>
        <Preview />
      </main>

      <motion.section className="steps" variants={rise} initial="hidden" animate="show" custom={4}>
        <h2>{t.howTitle}</h2>
        {[t.how1, t.how2, t.how3, t.how4].map((s, i) => (
          <div className="step" key={i}>
            <b>{i + 1}</b>
            <span>{s}</span>
          </div>
        ))}
      </motion.section>

      <footer className="landing-foot">
        <span>{t.privacy}</span>
        <span>{t.notAffiliated}</span>
      </footer>

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
    </div>
  );
}
