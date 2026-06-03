const express = require("express");
const puppeteer = require("puppeteer");

const app = express();

// ====== 配置区域：根据你的实际情况修改 ======
const VIKA_TOKEN = "uskpjOZKYkXL2lJWWzGfkF9";
const VIKA_DATASHEET_ID = "dstMlQqwPVwHk920bK";
// =================================================

// 获取今天 00:00 的时间戳（毫秒）
function getTodayStartTs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// 把毫秒转成 HH:MM:SS
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// 从维格表拉取事件流
async function fetchVikaEvents() {
  const url = `https://api.vika.cn/fusion/v1/datasheets/${VIKA_DATASHEET_ID}/records?pageSize=1000`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${VIKA_TOKEN}`
    }
  });

  if (!res.ok) {
    throw new Error(`Vika API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const records = json.data.records || [];

  // 映射成统一事件结构
  const events = records.map(r => {
    const f = r.fields || {};
    // timestamp 可能带逗号，先去掉
    let tsRaw = f.timestamp;
    if (typeof tsRaw === "string") {
      tsRaw = tsRaw.replace(/,/g, "");
    }
    const ts = Number(tsRaw) || 0;

    return {
      key: f.key,
      value: f.value,
      timestamp: ts,
      type: f.type,
      shift_type: f.shift_type,
      task_id: f.task_id
    };
  });

  return events;
}

// 从事件流中计算“今日汇总数据”
async function computeTodayStats() {
  const allEvents = await fetchVikaEvents();
  const todayStart = getTodayStartTs();

  // 只保留“今天”的事件
  const todayEvents = allEvents.filter(e => e.timestamp >= todayStart);

  // 任务相关
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

  // 打卡状态
  const morningStart = todayEvents.find(e => e.shift_type === "morning" && e.type === "clock_start");
  const afternoonStart = todayEvents.find(e => e.shift_type === "afternoon" && e.type === "clock_start");
  const nightStart = todayEvents.find(e => e.shift_type === "night" && e.type === "clock_start");

  const morningStatus = morningStart ? "✔" : "✘";
  const afternoonStatus = afternoonStart ? "✔" : "✘";
  const nightStatus = nightStart ? "✔" : "✘";

  return {
    completedTasks,
    focusDuration: formatDuration(focusMs),
    morningStatus,
    afternoonStatus,
    nightStatus,
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false })
  };
}

// 生成 HTML（服务端注入数据）
function buildHtml(stats) {
  const {
    completedTasks,
    focusDuration,
    morningStatus,
    afternoonStatus,
    nightStatus,
    updatedAt
  } = stats;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1448, height=1072">
<title>Kindle Dashboard</title>
<style>
  body {
    margin: 0;
    padding: 40px;
    width: 1448px;
    height: 1072px;
    font-family: "Noto Sans SC", sans-serif;
    background: #fff;
    color: #000;
    -webkit-filter: grayscale(100%);
    filter: grayscale(100%);
  }
  .row { display: flex; justify-content: space-between; }
  .col { display: flex; flex-direction: column; }
  .center { text-align: center; margin-top: 80px; }
  .timer { font-size: 120px; font-weight: bold; }
  .bottom { margin-top: 60px; text-align: center; font-size: 26px; }
</style>
</head>
<body>
  <div class="row">
    <div class="col">
      <div style="font-size:32px;margin-bottom:10px;">今日概览</div>
      <div style="font-size:24px;">今日任务数：${completedTasks}</div>
      <div style="font-size:24px;">上午打卡：${morningStatus}</div>
      <div style="font-size:24px;">下午打卡：${afternoonStatus}</div>
      <div style="font-size:24px;">晚上打卡：${nightStatus}</div>
    </div>
  </div>

  <div class="center">
    <div class="timer">${focusDuration}</div>
    <div style="font-size:28px;">今日专注时长</div>
  </div>

  <div class="bottom">
    <div>更新时间：${updatedAt}</div>
    <div style="margin-top:10px;">Victory Belongs To The Most Persevering.</div>
  </div>
</body>
</html>`;
}

// 调试用：直接返回 HTML
app.get("/", async (req, res) => {
  try {
    const stats = await computeTodayStats();
    const html = buildHtml(stats);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Error generating HTML:", err);
    res.status(500).send("Error generating HTML");
  }
});

// Kindle 用：返回 PNG
app.get("/dashboard.png", async (req, res) => {
  let browser;
  try {
    const stats = await computeTodayStats();
    const html = buildHtml(stats);

    browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer"
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: 1448,
      height: 1072,
      deviceScaleFactor: 1
    });

    await page.setContent(html, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({
      type: "png",
      fullPage: false
    });

    res.set("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error("Error generating dashboard PNG:", err);
    res.status(500).send("Error generating dashboard PNG");
  } finally {
    if (browser) await browser.close();
  }
});

// Render 注入 PORT
app.listen(process.env.PORT || 3000, () => {
  console.log("Kindle dashboard service running");
});
