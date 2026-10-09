import "@fontsource/patrick-hand";
import "./style.css";
import { render } from "./ui/app.ts";

/** The game is drawn on a fixed 920 x 412 stage (a Pixel 9 held sideways) and scaled to fit any screen. */
const STAGE_W = 920;
const STAGE_H = 412;

function fit(): void {
  const stage = document.getElementById("stage");
  if (!stage) return;
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

window.addEventListener("resize", fit);
window.addEventListener("orientationchange", fit);
fit();
render();
