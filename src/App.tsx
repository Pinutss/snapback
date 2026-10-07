import { AnimatePresence } from "motion/react";
import { useEffect } from "react";
import { Landing } from "./components/Landing";
import { Library } from "./components/Library";
import { Loading } from "./components/Loading";
import { Viewer } from "./components/Viewer";
import { useStore } from "./store";

export default function App() {
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.progress);
  const hasLibrary = useStore((s) => s.memories.length > 0);
  const init = useStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  // Status bar colour (Android, installed app): yellow on the landing page, page background in the library.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => meta?.setAttribute("content", hasLibrary ? (dark.matches ? "#000000" : "#ffffff") : "#FFFC00");
    apply();
    dark.addEventListener("change", apply);
    return () => dark.removeEventListener("change", apply);
  }, [hasLibrary]);

  return (
    <>
      {hasLibrary ? <Library /> : <Landing />}
      <Viewer />
      <AnimatePresence>{status === "loading" && progress && <Loading progress={progress} />}</AnimatePresence>
    </>
  );
}
