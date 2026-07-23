import { chromium } from "playwright";
import dayjs from "dayjs";
import { writeLog } from "../lib/logger.js";
import { getTargetDates } from "../lib/dateUtils.js";
import { loadFingerprints, saveFingerprints } from "../lib/state.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SKIP_STATUS = new Set(["空きなし", "申込期間外", "公開対象外", "利用時間外"]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Home画面から施設別空き状況(週表示)まで遷移し、指定週数ぶん「次の期間」を押して進める
// ブラウザコンテキストは毎回新規に作成する(セッション状態の持ち越しで選択施設が
// 意図せず変わる事象があったため、呼び出しごとに独立させている)
async function gotoWeekOnce(browser, siteConfig, weekIndex) {
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();
  await page.goto(siteConfig.homeUrl, { waitUntil: "networkidle", timeout: 30000 });

  await page.click("text=施設種類から探す");
  await page.waitForTimeout(300);
  await page.click(`text=${siteConfig.facilityCategory}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.locator(`text=${siteConfig.facilityName}`).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "次へ進む" }).first().click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  for (let i = 0; i < weekIndex; i++) {
    await page.click("text=次の期間");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
  }

  return { page, context };
}

// サーバーへの負荷軽減のため各アクセス間隔をあけつつ、一時的な失敗はリトライする
async function gotoWeek(browser, siteConfig, weekIndex, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await gotoWeekOnce(browser, siteConfig, weekIndex);
    } catch (err) {
      writeLog(`[${siteConfig.id}] 週アクセス失敗(${attempt}/${retries}): ${err.message}`);
      if (attempt >= retries) throw err;
      await sleep(3000);
    }
  }
}

function parseTimeValue(v) {
  const n = Number(v);
  return Math.floor(n / 100) * 60 + (n % 100);
}

function toHHMM(minutes) {
  const pad = n => String(n).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// 時間帯別空き状況ページから空きブロックを読み取り、しきい値以上のものを返す
async function extractVacantBlocks(page, minVacantMinutes) {
  const raw = await page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('input[name*="TimeFrom"]')).map(inp => inp.closest("div"));
    return wrappers.map(w => {
      const toggle = w.querySelector(".btn-group-toggle");
      const available = toggle ? toggle.className.includes("vacant") : false;
      const timeFrom = w.querySelector('input[name*="TimeFrom"]')?.value;
      const timeTo = w.querySelector('input[name*="TimeTo"]')?.value;
      return { timeFrom, timeTo, available };
    });
  });

  return raw
    .filter(b => b.available && b.timeFrom && b.timeTo)
    .map(b => ({ start: parseTimeValue(b.timeFrom), end: parseTimeValue(b.timeTo) }))
    .filter(b => (b.end - b.start) >= minVacantMinutes)
    .map(b => ({ start: toHHMM(b.start), end: toHHMM(b.end) }));
}

export async function checkSite(siteConfig) {
  const { id, name, monthsAhead, minVacantMinutes, rooms } = siteConfig;
  const { dates, holidays } = await getTargetDates(monthsAhead, writeLog);
  const targetDateSet = new Set(dates);
  const cutoff = dayjs().add(monthsAhead, "month");
  const maxWeeks = Math.ceil((monthsAhead * 31) / 7) + 1;

  const results = [];
  const flaggedCells = []; // { weekIndex, roomName, dateStr }
  // 部屋+日付単位で前回のステータスと空き枠をキャッシュし、変化がなければ
  // 時間帯別空き状況への再アクセスを省略してサーバー負荷を抑える
  const cache = loadFingerprints(id);
  const nextCache = {};

  const browser = await chromium.launch();
  try {
    // フェーズ1: 各週の空き状況一覧(日単位)を確認し、詳細確認が必要なセルを洗い出す
    let cursor = dayjs().startOf("day");
    for (let week = 0; week < maxWeeks && cursor.isBefore(cutoff); week++) {
      writeLog(`[${id}] 週アクセス: ${cursor.format("YYYY-MM-DD")}〜`);
      const { page, context } = await gotoWeek(browser, siteConfig, week);

      for (const roomName of rooms) {
        const row = page.locator("table.table-schedule tbody tr", { hasText: roomName }).first();
        if (await row.count() === 0) continue;

        const cellCount = await row.locator("td.btn-group-toggle").count();
        for (let col = 0; col < cellCount; col++) {
          const cell = row.locator("td.btn-group-toggle").nth(col);
          const status = (await cell.locator(".sr-only").innerText()).trim();
          if (SKIP_STATUS.has(status)) continue;

          const dateAttr = await cell.locator('input[name*="UseDate"]').getAttribute("value");
          if (!dateAttr) continue;
          const dateStr = dateAttr.slice(0, 10);
          if (!targetDateSet.has(dateStr)) continue;

          const cacheKey = `${roomName}|${dateStr}`;
          const cached = cache[cacheKey];
          if (cached && cached.status === status) {
            // 前回チェック時からステータスが変わっていないため詳細確認をスキップ
            nextCache[cacheKey] = cached;
            cached.blocks.forEach(b => {
              results.push({
                siteId: id,
                siteName: name,
                facilityName: siteConfig.facilityName,
                roomName,
                date: dateStr,
                url: cached.url,
                timeStart: b.start,
                timeEnd: b.end
              });
            });
            continue;
          }

          flaggedCells.push({ weekIndex: week, roomName, dateStr, status });
        }
      }

      await context.close();
      cursor = cursor.add(7, "day");
      await sleep(1500);
    }

    writeLog(`[${id}] 詳細確認対象: ${flaggedCells.length}件`);

    // フェーズ2: 詳細確認が必要なセルだけ、時間帯別空き状況を取得する
    for (const cellInfo of flaggedCells) {
      const { page, context } = await gotoWeek(browser, siteConfig, cellInfo.weekIndex);
      const row = page.locator("table.table-schedule tbody tr", { hasText: cellInfo.roomName }).first();
      const cells = row.locator("td.btn-group-toggle");
      const cellCount = await cells.count();

      let targetCol = -1;
      for (let col = 0; col < cellCount; col++) {
        const dateAttr = await cells.nth(col).locator('input[name*="UseDate"]').getAttribute("value");
        if (dateAttr && dateAttr.slice(0, 10) === cellInfo.dateStr) {
          targetCol = col;
          break;
        }
      }

      if (targetCol === -1) {
        writeLog(`[${id}] 対象セルが見つかりません: ${cellInfo.roomName} ${cellInfo.dateStr}`);
        await context.close();
        continue;
      }

      await cells.nth(targetCol).locator("label.btn-toggle").click({ force: true });
      await page.getByRole("button", { name: "次へ進む" }).first().click({ force: true });
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);

      const blocks = await extractVacantBlocks(page, minVacantMinutes);
      const url = page.url();
      nextCache[`${cellInfo.roomName}|${cellInfo.dateStr}`] = { status: cellInfo.status, blocks, url };
      blocks.forEach(b => {
        results.push({
          siteId: id,
          siteName: name,
          facilityName: siteConfig.facilityName,
          roomName: cellInfo.roomName,
          date: cellInfo.dateStr,
          url,
          timeStart: b.start,
          timeEnd: b.end
        });
      });

      await context.close();
      await sleep(1500);
    }
  } finally {
    await browser.close();
    saveFingerprints(id, nextCache);
  }

  return results;
}
