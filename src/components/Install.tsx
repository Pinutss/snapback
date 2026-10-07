import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../lib/i18n";
import { promptInstall, useInstallMode } from "../lib/install";
import { IconClose, IconInstall, IconShare, IconSquarePlus, Logo } from "./Icons";

/** Bottom sheet explaining "Add to Home Screen" on iOS, where there is no install prompt. */
function IosSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <motion.div
        className="sheet-backdrop"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => (info.offset.y > 90 || info.velocity.y > 500) && onClose()}
      >
        <div className="sheet-grip" />
        <button className="sheet-close icon-btn" onClick={onClose} aria-label={t.close}>
          <IconClose />
        </button>
        <div className="sheet-app">
          <Logo />
          <div>
            <h2 id="install-title">{t.installTitle}</h2>
            <p>{t.installNote}</p>
          </div>
        </div>
        <ol className="sheet-steps">
          <li>
            <b>1</b>
            <span>{t.installIos1}</span>
            <IconShare />
          </li>
          <li>
            <b>2</b>
            <span>{t.installIos2}</span>
            <IconSquarePlus />
          </li>
          <li>
            <b>3</b>
            <span>{t.installIos3}</span>
            <Logo />
          </li>
        </ol>
      </motion.div>
    </>
  );
}

/**
 * "Install the app" trigger. Renders nothing when the app is already installed
 * or the browser can't install it.
 */
export function InstallButton({
  className,
  children,
  label,
}: {
  className: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const mode = useInstallMode();
  const [sheet, setSheet] = useState(false);
  if (!mode && !sheet) return null;
  return (
    <>
      {mode && (
        <button className={className} aria-label={label} title={label} onClick={() => (mode === "ios" ? setSheet(true) : promptInstall())}>
          {children ?? (
            <>
              <IconInstall />
              <span>{t.install}</span>
            </>
          )}
        </button>
      )}
      {/* Portal: headers use backdrop-filter, which would trap a fixed sheet. */}
      {createPortal(
        <AnimatePresence>{sheet && <IosSheet onClose={() => setSheet(false)} />}</AnimatePresence>,
        document.body,
      )}
    </>
  );
}
