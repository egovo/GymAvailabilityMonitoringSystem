import { chromium } from "playwright";
import dayjs from "dayjs";
import { writeLog } from "../lib/logger.js";
import { getTargetDates } from "../lib/dateUtils.js";
import { loadFingerprints, saveFingerprints } from "../lib/state.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SKIP_STATUS = new Set(["空き無し", "休館日", "予約期間外"]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTimeValue(v) {
  const n = Number(v);
  return Math.floor(n / 100) * 60 + (n % 100);
}

function toHHMM(minutes) {
  const pad = n => String(n).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// 「利用時間の選択」ページのチェックボックス一覧から、しきい値以上連続する空き枠を抽出する
async function extractVacantBlocks(page, minVacantMinutes) {
  const slots = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input[name="YoyakuCB"]')).map(cb => {
      const labels = document.querySelectorAll(`label[for="${cb.id}"]`);
      const statusLabel = labels[labels.length - 1];
      const status = statusLabel ? statusLabel.textContent.trim() : "";
      const [start, end] = cb.value.split(":");
      return { start, end, available: status === "(空き)" };
    });
  });

  const sorted = slots
    .map(s => ({ start: parseTimeValue(s.start), end: parseTimeValue(s.end), available: s.available }))
    .sort((a, b) => a.start - b.start);

  const blocks = [];
  let cur = null;
  for (const s of sorted) {
    if (s.available) {
      if (cur && cur.end === s.start) {
        cur.end = s.end;
      } else {
        if (cur) blocks.push(cur);
        cur = { start: s.start, end: s.end };
      }
    } else {
      if (cur) blocks.push(cur);
      cur = null;
    }
  }
  if (cur) blocks.push(cur);

  return blocks
    .filter(b => (b.end - b.start) >= minVacantMinutes)
    .map(b => ({ start: toHHMM(b.start), end: toHHMM(b.end) }));
}

// トップから「施設案内・予約」→「施設名で探す」→指定施設 の週間空き状況ページまで遷移する
async function gotoFacilityWeekly(page, entryUrl, facilityName) {
  await page.goto(entryUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.click("text=施設案内・予約");
  await page.waitForLoadState("networkidle");
  await page.click("#ykr30001c_SisetuImgButton");
  await page.waitForLoadState("networkidle");
  await page.click(`text=${facilityName}`);
  await page.waitForLoadState("networkidle");
}

export async function checkSite(siteConfig) {
  const { id, name, monthsAhead, minVacantMinutes, entryUrl, facilities } = siteConfig;
  const { dates, holidays } = await getTargetDates(monthsAhead, writeLog);
  const targetDateSet = new Set(dates);
  const cutoff = dayjs().add(monthsAhead, "month");
  const maxWeeks = Math.ceil((monthsAhead * 31) / 7) + 1;

  const results = [];
  // 部屋+日付単位で前回のステータスと空き枠をキャッシュし、変化がなければ
  // 詳細画面(利用時間の選択)への再アクセスを省略してサーバー負荷を抑える
  const cache = loadFingerprints(id);
  const nextCache = {};

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    for (const facility of facilities) {
      writeLog(`[${id}] 施設アクセス: ${facility.name}`);
      await gotoFacilityWeekly(page, entryUrl, facility.name);

      let cursor = dayjs().startOf("day");

      for (let week = 0; week < maxWeeks && cursor.isBefore(cutoff); week++) {
        if (week > 0) {
          await page.click("#WeeklyAkiListCtrl_NextWeekImgBtn");
          await page.waitForLoadState("networkidle");
        }

        const weekDates = Array.from({ length: 7 }, (_, i) => cursor.add(i, "day").format("YYYY-MM-DD"));

        for (const room of facility.rooms) {
          const row = page
            .locator("tr.calendar-datarow-week")
            .filter({ has: page.locator("td.table-cell-name a", { hasText: new RegExp(`^${escapeRegExp(room.name)}$`) }) })
            .first();
          if (await row.count() === 0) continue;

          const cellImgs = row.locator("td.table-cell-image img");
          const total = await cellImgs.count();
          const dataCellCount = Math.min(7, total - 2);

          for (let col = 0; col < dataCellCount; col++) {
            const dateStr = weekDates[col];
            if (!targetDateSet.has(dateStr)) continue;

            const alt = (await cellImgs.nth(col).getAttribute("alt")) || "";
            if (SKIP_STATUS.has(alt)) continue;

            const cacheKey = `${facility.code}|${room.code}|${dateStr}`;
            const cached = cache[cacheKey];
            let blocks;
            let url;

            if (cached && cached.status === alt) {
              // 前回チェック時からステータスが変わっていないため詳細確認をスキップ
              blocks = cached.blocks;
              url = cached.url;
            } else {
              const cellLink = row.locator("td.table-cell-image").nth(col).locator("a").first();
              if (await cellLink.count() === 0) continue;

              await cellLink.click();
              await page.waitForLoadState("networkidle");

              url = page.url();
              blocks = await extractVacantBlocks(page, minVacantMinutes);

              await page.goBack();
              await page.waitForLoadState("networkidle");
              await sleep(800);
            }

            nextCache[cacheKey] = { status: alt, blocks, url };
            blocks.forEach(b => {
              results.push({
                siteId: id,
                siteName: name,
                facilityName: facility.name,
                roomName: room.name,
                date: dateStr,
                url,
                timeStart: b.start,
                timeEnd: b.end
              });
            });
          }
        }

        cursor = cursor.add(7, "day");
        await sleep(1000);
      }
    }
  } finally {
    await browser.close();
    saveFingerprints(id, nextCache);
  }

  return results;
}
