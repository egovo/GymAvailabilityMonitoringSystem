import { load } from "cheerio";
import { writeLog } from "../lib/logger.js";
import { getTargetDates, formatDateLabel } from "../lib/dateUtils.js";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 対象サイトのHTML取得（最大3回リトライ）
async function fetchPage(url, referer, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Referer": referer }
      });

      if (res.ok) {
        return await res.text();
      } else {
        writeLog(`fetch失敗 (${res.status}) ${url} (試行 ${attempt}/${retries})`);
      }
    } catch (err) {
      writeLog(`fetchエラー: ${err.message} (試行 ${attempt}/${retries})`);
    }

    if (attempt < retries) await sleep(1000);
  }

  writeLog(`⚠️ 最大リトライ回数に達しました: ${url}`);
  return null;
}

function parseCourtTableCheerio(html, courtLabels) {
  const $ = load(html);
  const grid = [];

  $("span.font3").each((_, span) => {
    const text = $(span).text().trim();
    if (courtLabels.includes(text)) {
      const tdList = $(span).closest("td").nextAll("td");
      const colors = [];
      tdList.each((_, td) => {
        const bgcolor = $(td).attr("bgcolor");
        colors.push(bgcolor ? bgcolor.toLowerCase() : "");
      });
      grid.push(colors);
    }
  });

  return grid;
}

// 1コマ=1時間として、指定分数以上連続で空いている(白背景の)列を検出する
function findConsecutiveVacantCols(grid, minVacantMinutes) {
  if (grid.length < 4) return [];
  const cols = grid[0].length;
  const minCols = Math.ceil(minVacantMinutes / 60);

  const vacant = [];
  for (let c = 0; c < cols; c++) {
    const isVacant = grid.every(row => row[c]?.startsWith("#fff"));
    vacant.push(isVacant);
  }

  const result = [];
  let start = -1;

  for (let i = 0; i < cols; i++) {
    if (vacant[i] && start === -1) start = i;
    if ((!vacant[i] || i === cols - 1) && start !== -1) {
      const end = vacant[i] ? i : i - 1;
      if (end - start + 1 >= minCols) result.push({ start, end });
      start = -1;
    }
  }
  return result;
}

function colToTimeRange(startCol, endCol) {
  const startHour = 9 + (startCol - 1);
  const endHour = 9 + endCol;
  const pad = (n) => String(n).padStart(2, "0");
  return { start: `${pad(startHour)}:00`, end: `${pad(endHour)}:00` };
}

export async function checkSite(siteConfig) {
  const { id, name, baseUrl, courtLabels, monthsAhead, minVacantMinutes } = siteConfig;
  const { dates: targetDates, holidays } = await getTargetDates(monthsAhead, writeLog);
  const results = [];

  for (const dateStr of targetDates) {
    const date = new Date(dateStr);
    writeLog(`[${id}] アクセス: ${formatDateLabel(dateStr, holidays)}`);

    const url = `${baseUrl}?y_n=${date.getFullYear()}&m_n=${date.getMonth() + 1}&d_n=${date.getDate()}`;
    const html = await fetchPage(url, baseUrl);

    if (!html) {
      throw new Error(`[${id}] ページ取得失敗: ${url}`);
    }

    const grid = parseCourtTableCheerio(html, courtLabels);
    const consecutiveCols = findConsecutiveVacantCols(grid, minVacantMinutes);

    consecutiveCols.forEach(c => {
      const { start, end } = colToTimeRange(c.start + 1, c.end + 1);
      results.push({
        siteId: id,
        siteName: name,
        facilityName: name,
        roomName: "バドミントンコート",
        date: dateStr,
        url,
        timeStart: start,
        timeEnd: end
      });
    });

    await sleep(2000);
  }

  return results;
}
