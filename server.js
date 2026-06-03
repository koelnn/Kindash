const express = require("express");
const puppeteer = require("puppeteer");

const app = express();

// 你的 HTML 页面地址（注意必须是字符串）
const DASHBOARD_URL = "https://kindledash.onrender.com/";

app.get("/dashboard.png", async (req, res) => {
  let browser;

  try {
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

    // Kindle 横屏分辨率
    await page.setViewport({
      width: 1448,
      height: 1072,
      deviceScaleFactor: 1
    });

    // 访问你的 HTML 页面
    await page.goto(DASHBOARD_URL, {
      waitUntil: "networkidle0",
      timeout: 60000
    });

    // 截图
    const buffer = await page.screenshot({
      type: "png",
      fullPage: false
    });

    res.set("Content-Type", "image/png");
    res.send(buffer);

  } catch (err) {
    console.error("Error generating dashboard:", err);
    res.status(500).send("Error generating dashboard");
  } finally {
    if (browser) await browser.close();
  }
});

// Render 会自动注入 PORT
app.listen(process.env.PORT || 3000, () => {
  console.log("Dashboard service running");
});
