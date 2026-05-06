import { mountSidebar } from "./components/sidebar.js";
import { mountQueueDock } from "./components/queueDock.js";
import { renderRender } from "./screens/render.js";
import { renderSnow } from "./screens/snow.js";
import { renderTrim } from "./screens/trim.js";
import { renderCutBg } from "./screens/cutBg.js";
import { renderQueue } from "./screens/queue.js";
import { renderSettings } from "./screens/settings.js";
import { renderOnboarding } from "./screens/onboarding.js";
import { toast } from "./components/toast.js";

const screens = {
  render: renderRender, snow: renderSnow, trim: renderTrim, cutBg: renderCutBg,
  queue: renderQueue, settings: renderSettings,
};

const sidebarEl = document.getElementById("sidebar");
const contentEl = document.getElementById("content");
const dockEl = document.getElementById("queue-dock");

async function navigate(name) {
  const fn = screens[name];
  if (!fn) return;
  contentEl.innerHTML = "";
  await fn(contentEl);
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.screen === name));
  window.location.hash = name;
}

window.addEventListener("hashchange", () => {
  const name = window.location.hash.slice(1) || "render";
  navigate(name);
});

async function bootstrap() {
  const ws = await window.api.app.getWorkspace();
  if (!ws) {
    contentEl.innerHTML = "";
    await renderOnboarding(contentEl, async (chosen) => {
      await window.api.settings.set({ workspace: chosen });
      await navigate("render");
    });
    return;
  }
  mountSidebar(sidebarEl, navigate);
  mountQueueDock(dockEl);
  const initial = window.location.hash.slice(1) || "render";
  await navigate(initial);
}

bootstrap();

const completedSeen = new Set();
window.api.queue.onUpdate((state) => {
  for (const j of state.completed) {
    if (completedSeen.has(j.id)) continue;
    completedSeen.add(j.id);
    if (j.status === "done") {
      toast({ message: `✅ ${labelOf(j.type)} hoàn thành`, kind: "success",
              onClick: () => j.result?.outputs?.[0] && window.api.shell.openFolder(j.result.outputs[0].replace(/[/\\][^/\\]+$/, "")) });
    } else if (j.status === "error") {
      import("./components/modal.js").then(({ showErrorModal }) =>
        showErrorModal({ summary: `Task ${labelOf(j.type)} thất bại`, error: j.error, jobId: j.id }));
    }
  }
});

const TASK_LABELS = { render: "Render Video", snow: "Snow", trim: "Trim", cutBg: "Cut BG" };
function labelOf(t) { return TASK_LABELS[t] || t; }
