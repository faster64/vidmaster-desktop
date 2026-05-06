import fs from "fs";
import path from "path";
import { TaskRunner } from "./_lib/runner.js";
import { fetchUploadsPlaylistId, listAllUploadVideos } from "./_lib/youtube.js";

export async function runGetUrls(config) {
  const runner = new TaskRunner(config);
  const {
    handle, apiKey, workspace,
    minDurationMinutes = 8,
    sortOrder = "VIEW",
  } = config;
  const { signal } = config;

  if (!handle) throw new Error("Thiếu handle.");
  if (!apiKey) throw new Error("Thiếu YouTube API key.");
  if (!workspace) throw new Error("Thiếu workspace.");

  runner.checkAborted();
  runner.setProgress(5, "Đang tìm kênh...");

  const playlistId = await fetchUploadsPlaylistId({ apiKey, handle, signal });
  runner.checkAborted();

  const videos = await listAllUploadVideos({
    apiKey, playlistId, signal,
    onPage: ({ pagesDone, totalPages }) => {
      const pct = 5 + Math.min(85, (pagesDone / Math.max(1, totalPages)) * 85);
      runner.setProgress(pct, `Đã đọc ${pagesDone}/${totalPages} trang`);
    },
  });

  runner.checkAborted();
  runner.setProgress(90, "Lọc & sắp xếp...");

  const minSec = minDurationMinutes * 60;
  const filtered = videos.filter((v) => v.durationSec > minSec);

  let sorted;
  if (sortOrder === "LATEST") {
    sorted = filtered.slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  } else if (sortOrder === "MIX") {
    sorted = filtered.slice().sort(() => Math.random() - 0.5);
  } else {
    sorted = filtered.slice().sort((a, b) => b.viewCount - a.viewCount);
  }

  const handleSafe = handle.replace(/^@/, "");
  const dir = path.join(workspace, "channels", handleSafe);
  fs.mkdirSync(dir, { recursive: true });
  const urlsPath = path.join(dir, "only_video_urls.txt");
  const infosPath = path.join(dir, "video_infos.txt");

  const urls = sorted.map((v) => `https://www.youtube.com/watch?v=${v.id}`).join("\n") + (sorted.length ? "\n" : "");
  const infos = sorted.map((v) =>
    `${v.publishedAt}\thttps://www.youtube.com/watch?v=${v.id}\t${v.viewCount}\t${v.title}\t${formatDur(v.durationSec)}`
  ).join("\n") + (sorted.length ? "\n" : "");

  fs.writeFileSync(urlsPath, urls, "utf8");
  fs.writeFileSync(infosPath, infos, "utf8");

  runner.setProgress(100, `Đã ghi ${sorted.length} URLs`);
  runner.log("info", `${sorted.length} videos written to ${urlsPath}`);

  return {
    ok: true,
    outputs: [urlsPath, infosPath],
    videos: sorted,
    errors: [],
  };
}

function formatDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function pad(n) { return String(n).padStart(2, "0"); }
