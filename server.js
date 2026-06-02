const express = require('express');
const https = require('https');
const path = require('path');
const app = express();

const VIKA_TOKEN = process.env.VIKA_TOKEN || '';
const DATASHEET_ID = process.env.DATASHEET_ID || '';
const SUMMARY_DATASHEET_ID = process.env.SUMMARY_DATASHEET_ID || '';
const PORT = process.env.PORT || 3000;

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchVika(datasheetId, pageSize = 1000) {
  if (!VIKA_TOKEN || !datasheetId) return [];
  const url = `https://api.vika.cn/fusion/v1/datasheets/${encodeURIComponent(datasheetId)}/records?pageSize=${pageSize}`;
  const res = await httpsGet(url, { Authorization: `Bearer ${VIKA_TOKEN}`, 'Content-Type': 'application/json' });
  return res.body?.data?.records || [];
}

async function fetchPoem() {
  try {
    const res = await httpsGet('https://v2.jinrishici.com/one.json');
    return res.body?.data?.content || '枕上诗书闲处好';
  } catch(e) { return '枕上诗书闲处好'; }
}

async function fetchWeather() {
  try {
    const res = await httpsGet('https://wttr.in/%E5%8C%97%E4%BA%AC?format=j1', { 'Accept': 'application/json' });
    const t = res.body?.current_condition?.[0]?.temp_C || '25';
    return `北京 ${t}°C`;
  } catch(e) { return '北京 25°C'; }
}

function sameDay(ts) {
  const d = new Date(Number(ts));
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function fmtDuration(ms) {
  ms = Math.max(0, Math.round(ms || 0));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
}

function textOr(v, f = '') {
  if (v === null || v === undefined) return f;
  const s = String(v).trim();
  return s || f;
}

function parseClockRecords(records) {
  const rows = records.map(r => r.fields || {}).filter(f => sameDay(f.timestamp));
  const shifts = { morning: false, afternoon: false, evening: false };
  const byTask = new Map();
  for (const f of rows) {
    const shift = String(f.shift_type || '').toLowerCase();
    const type = String(f.type || '').toLowerCase();
    const taskId = textOr(f.task_id, '');
    const ts = Number(f.timestamp || 0);
    if (shift in shifts) shifts[shift] = true;
    if (!taskId) continue;
    if (!byTask.has(taskId)) byTask.set(taskId, []);
    byTask.get(taskId).push({ type, ts, f });
  }
  let completeCount = 0, totalMs = 0, currentTask = '', currentStart = 0;
  const active = [];
  for (const [taskId, arr] of byTask.entries()) {
    arr.sort((a, b) => a.ts - b.ts);
    let stack = null;
    for (const item of arr) {
      if (item.type === 'clock_start') stack = item;
      else if (item.type === 'clock_end' && stack) {
        completeCount++;
        totalMs += Math.max(0, item.ts - stack.ts);
        stack = null;
      }
    }
    if (stack) active.push({ taskId, start: stack.ts, remark: textOr(stack.f.remark, '') });
  }
  if (active.length) {
    active.sort((a, b) => b.start - a.start);
    currentTask = active[0].remark || active[0].taskId;
    currentStart = active[0].start;
  }
  return { shifts, completeCount, totalMs, currentTask, currentStart, hasActive: active.length > 0 };
}

app.use(express.static(__dirname));

app.get('/api/data', async (req, res) => {
  try {
    const [mainRecords, summaryRecords, poem, weather] = await Promise.all([
      fetchVika(DATASHEET_ID, 1000),
      SUMMARY_DATASHEET_ID ? fetchVika(SUMMARY_DATASHEET_ID, 1000).catch(() => []) : Promise.resolve([]),
      fetchPoem(),
      fetchWeather()
    ]);
    const todayRecords = mainRecords.filter(r => sameDay(r.fields?.timestamp || 0));
    const parsed = parseClockRecords(todayRecords);
    const mainFields = todayRecords[0]?.fields || {};
    const summaryFields = summaryRecords[0]?.fields || {};
    const now = Date.now();
    const updatedAt = new Date(Number(mainFields.timestamp || summaryFields.timestamp || now))
      .toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .replace(/\//g, '-');

    res.json({
      userName: textOr(summaryFields.userName || mainFields.userName || '大童'),
      weather,
      poem,
      currentTask: parsed.hasActive ? (parsed.currentTask || '正在计时') : '无任务',
      currentDuration: parsed.hasActive ? fmtDuration(now - parsed.currentStart) : '--:--',
      shifts: parsed.shifts,
      taskCount: parsed.completeCount ? `今日${parsed.completeCount}任务` : '今日（）任务',
      totalFocus: parsed.totalMs ? `累计${fmtDuration(parsed.totalMs)}` : '累计（）小时',
      updatedAt,
      serverTime: now
    });
  } catch (e) {
    res.json({
      userName: '大童', weather: '北京 25°C', poem: '枕上诗书闲处好',
      currentTask: '无任务', currentDuration: '--:--',
      shifts: { morning: false, afternoon: false, evening: false },
      taskCount: '今日（）任务', totalFocus: '累计（）小时',
      updatedAt: new Date().toLocaleString('zh-CN',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(/\//g,'-'),
      serverTime: Date.now()
    });
  }
});

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
