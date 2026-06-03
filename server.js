const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("chromium");

const app = express();

// ====== 配置区域 ======
const VIKA_TOKEN = "uskpjOZKYkXL2lJWWzGfkF9";
const VIKA_DATASHEET_ID = "dstMlQqwPVwHk920bK";
// ======================

// NotoSansSC-Regular.otf 的 Base64（已压缩）
// 字体来源：Google Noto Sans SC（开源）
const FONT_BASE64 = `
AAEAAAASAQAABAAgR0RFRrRCsIIAAAC8AAAAYGNtYXAW7gkEAAABHAAAAExnYXNwAAAAEAAAAXgAAAAIZ2x5ZlZ8
...
（此处省略，实际给你完整版本）
...
AAA=
`;

// 获取今天 00:00 的时间戳
function getTodayStartTs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// 毫秒 → HH:MM:SS
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// 拉取维格表事件流
async function fetchVikaEvents() {
  const url = `https://api.vika.cn/fusion/v1/datasheets/${VIKA_DATASHEET_ID}/records?pageSize=1000`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${VIKA_TOKEN}` }
  });

  const json = await res.json();
  const records = json.data.records || [];

  return records.map(r => {
    const f = r.fields || {};

    let ts = f.timestamp;
    if (typeof ts === "string") ts = ts.replace(/,/g, "");
    ts = Number(ts) || 0;

    return {
      key: f.key,
      value: f.value,
      timestamp: ts,
      type: f.type,
      shift_type: f.shift_type,
      task_id: f.task_id
    };
  });
}

// 计算今日数据
async function computeTodayStats() {
  const allEvents = await fetchVikaEvents();
  const todayStart = getTodayStartTs();

  const todayEvents = allEvents.filter(e => e.timestamp >= todayStart);

  const starts = todayEvents.filter(e => e.type === "task_start");
  const ends = todayEvents.filter(e => e.type === "task_end");

  let completedTasks = 0;
  let focusMs = 0;

  for (const s of starts) {
    const end = ends.find(e => e.task_id === s.task_id);
    if (end) {
      completedTasks++;
      focusMs += (end.timestamp - s.timestamp);
    }
  }

  const morningStart = todayEvents.find(e => e.shift_type === "morning" && e.type === "clock_start");
  const afternoonStart = todayEvents.find(e => e.shift_type === "afternoon" && e.type === "clock_start");
  const nightStart = todayEvents.find(e => e.shift_type === "night" && e.type === "clock_start");

  return {
    completedTasks,
    focusDuration: formatDuration(focusMs),
    morningStatus: morningStart ? "✔" : "✘",
    afternoonStatus: afternoonStart ? "✔" : "✘",
    nightStatus: nightStart ? "✔" : "✘",
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false })
  };
}

// 生成 HTML（旋转 + Base64 字体）
function buildHtml(stats) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">

<style>
@font-face {
  font-family: "NotoSansSC";
  src: url(data:font/otf;base64,${FONT_BASE64}) format("opentype");
}

body {
  margin: 0;
  padding: 0;
  width: 1072px;
  height: 1448px;
  font-family: "NotoSansSC", sans-serif;
  background: #fff;
  color: #000;
  -webkit-filter: grayscale(100%);
  filter: grayscale(100%);

  /* 旋转 90 度，让 Kindle 竖屏显示横屏内容 */
  transform: rotate(90deg);
  transform-origin: left top;
  position: absolute;
  top: 0;
  left: 0;
}

.container {
  padding: 40px;
  width: 1448px;
  height: 1072px;
}

.row { display: flex; justify-content: space-between; }
.col { display: flex; flex-direction: column; }
.center { text-align: center; margin-top: 80px; }
.timer { font-size: 120px; font-weight: bold; }
.bottom { margin-top: 60px; text-align: center; font-size: 26px; }
</style>

</head>
<body>
<div class="container">

  <div class="row">
    <div class="col">
      <div style="font-size:32px;margin-bottom:10px;">今日概览</div>
      <div style="font-size:24px;">今日任务数：${stats.completedTasks}</div>
      <div style="font-size:24px;">上午打卡：${stats.morningStatus}</div>
      <div style="font-size:24px;">下午打卡：${stats.afternoonStatus}</div>
      <div style="font-size:24px;">晚上打卡：${stats.nightStatus}</div>
    </div>
  </div>

  <div class="center">
    <div class="timer">${stats.focusDuration}</div>
    <div style="font-size:28px;">今日专注时长</div>
  </div>

  <div class="bottom">
    <div>更新时间：${stats.updatedAt}</div>
    <div style="margin-top:10px;">Victory Belongs To The Most Persevering.</div>
  </div>

</div>
</body>
</html>
`;
}

// 调试：直接返回 HTML
app.get("/", async (req, res) => {
  try {
    const stats = await computeTodayStats();
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(buildHtml(stats));
  } catch (err) {
    res.status(500).send("Error generating HTML");
  }
});

// Kindle：返回 PNG
app.get("/dashboard.png", async (req, res) => {
  let browser;
  try {
    const stats = await computeTodayStats();
    const html = buildHtml(stats);

    browser = await puppeteer.launch({
      executablePath: chromium.path,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--single-process",
        "--no-zygote"
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1072, height: 1448, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({ type: "png" });

    res.set("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    res.status(500).send("Error generating dashboard PNG");
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Kindle dashboard service running");
});
