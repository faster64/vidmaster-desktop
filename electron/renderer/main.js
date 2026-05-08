import { mountSidebar } from "./components/sidebar.js";
import { mountQueueDock } from "./components/queueDock.js";
import { renderRender } from "./screens/render.js";
import { renderTrimEnds } from "./screens/trimEnds.js";
import { renderCutBg } from "./screens/cutBg.js";
import { renderGetUrls } from "./screens/getUrls.js";
import { renderDownload } from "./screens/download.js";
import { renderConcatHeadTail } from "./screens/concatHeadTail.js";
import { renderThumbAvatar } from "./screens/thumbAvatar.js";
import { renderQueue } from "./screens/queue.js";
import { renderSettings } from "./screens/settings.js";
import { renderOnboarding } from "./screens/onboarding.js";
import { toast } from "./components/toast.js";

const screens = {
  render: renderRender, trimEnds: renderTrimEnds, cutBg: renderCutBg,
  getUrls: renderGetUrls, download: renderDownload, concatHeadTail: renderConcatHeadTail,
  thumbAvatar: renderThumbAvatar,
  queue: renderQueue, settings: renderSettings,
};

const sidebarEl = document.getElementById("sidebar");
const contentEl = document.getElementById("content");
const dockEl = document.getElementById("queue-dock");

async function navigate(name) {
  const fn = screens[name];
  if (!fn) return;
  contentEl.innerHTML = "";
  contentEl.dataset.screen = name;
  await fn(contentEl);
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.screen === name));
  window.location.hash = name;
}

window.addEventListener("hashchange", () => {
  const name = window.location.hash.slice(1) || "render";
  navigate(name);
});

async function bootstrap() {
  const list = await window.api.workspace.list();
  if (list.length === 0) {
    contentEl.innerHTML = "";
    await new Promise((resolve) => {
      renderOnboarding(
        contentEl,
        { initialWorkspace: "", initialIdentifier: "" },
        async ({ workspace, identifier }) => {
          await window.api.app.ensureWorkspace(workspace);
          const ws = await window.api.workspace.create({ path: workspace, identifier });
          await window.api.workspace.setActive(ws.id);
          await window.api.app.trackingPing();
          resolve();
        },
      );
    });
  }
  await mountSidebar(sidebarEl, navigate);
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

const TASK_LABELS = {
  render: "Render Video", trimEnds: "Cắt đầu/cuối", cutBg: "Chia nhỏ video nền",
  getUrls: "Lấy link kênh", download: "Tải video", concatHeadTail: "Nối đầu/cuối",
  thumbAvatar: "Gắn avatar",
};
function labelOf(t) { return TASK_LABELS[t] || t; }
