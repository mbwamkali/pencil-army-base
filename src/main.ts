import { applySettings } from "./ui/settings.ts";
import "@fontsource/patrick-hand";
import "./style.css";
import { render } from "./ui/app.ts";

/** The game is drawn on a fixed 920 x 412 stage (a Pixel 9 held sideways) and scaled to fit any screen. */
const STAGE_W = 920;
const STAGE_H = 412;

/** Keep at least this much empty space around the game so rounded phone corners never cut into it. */
const MIN_MARGIN = 16;

/** The phone's own safe-area insets (camera cutout, rounded corners) in pixels, where it reports them. */
function safeInsets(): { top: number; right: number; bottom: number; left: number } {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.append(probe);
  const s = getComputedStyle(probe);
  const insets = {
    top: parseFloat(s.paddingTop) || 0,
    right: parseFloat(s.paddingRight) || 0,
    bottom: parseFloat(s.paddingBottom) || 0,
    left: parseFloat(s.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

function fit(): void {
  const stage = document.getElementById("stage");
  if (!stage) return;
  const inset = safeInsets();
  const left = Math.max(MIN_MARGIN, inset.left);
  const right = Math.max(MIN_MARGIN, inset.right);
  const top = Math.max(MIN_MARGIN, inset.top);
  const bottom = Math.max(MIN_MARGIN, inset.bottom);
  const scale = Math.min((window.innerWidth - left - right) / STAGE_W, (window.innerHeight - top - bottom) / STAGE_H);
  // Centre the stage in the area inside the margins.
  const cx = left + (window.innerWidth - left - right) / 2;
  const cy = top + (window.innerHeight - top - bottom) / 2;
  stage.style.left = `${cx}px`;
  stage.style.top = `${cy}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

window.addEventListener("resize", fit);
window.addEventListener("orientationchange", fit);
fit();
applySettings();
render();

// Offline play: the service worker is written at build time (see vite.config.ts), so it exists only in the built game.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
