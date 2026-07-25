import "dotenv/config";
import dayjs from "dayjs";
import { cleanOldLogs, writeLog } from "./lib/logger.js";
import { sendLineMessage } from "./lib/line.js";
import { shouldNotify, saveLastResults } from "./lib/state.js";
import { loadDashboardData, writeDashboardData } from "./lib/dashboard.js";
import { sites } from "./config/sites.js";
import { checkSite as checkOkegawa } from "./sites/okegawa.js";
import { checkSite as checkHasuda } from "./sites/hasuda.js";
import { checkSite as checkAgeo } from "./sites/ageo.js";

const adapters = { okegawa: checkOkegawa, hasuda: checkHasuda, ageo: checkAgeo };

// 週境界の再訪問等で同じ枠が複数回検出されることがあるため、通知・ダッシュボードに出す前に重複を除く
function dedupeResults(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = `${r.facilityName}|${r.roomName}|${r.date}|${r.timeStart}|${r.timeEnd}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMessage(siteName, results) {
  let msg = `🏀 ${siteName} 空き情報 🏀\n`;

  const byDate = {};
  results.forEach(r => {
    byDate[r.date] = byDate[r.date] || [];
    byDate[r.date].push(r);
  });

  Object.keys(byDate).sort().forEach(date => {
    msg += `\n${date}\n`;
    byDate[date].forEach(r => {
      msg += `　${r.facilityName} ${r.roomName}：${r.timeStart}〜${r.timeEnd}\n`;
    });
    msg += `${byDate[date][0].url}\n`;
  });

  return msg;
}

// ダッシュボード表示用に、通知の有無に関わらず毎回のチェック結果を返す
async function checkOneSite(siteConfig) {
  const adapter = adapters[siteConfig.adapter];
  if (!adapter) {
    writeLog(`[${siteConfig.id}] 未対応のアダプター: ${siteConfig.adapter}`);
    return { id: siteConfig.id, name: siteConfig.name, checkedAt: dayjs().format(), error: "未対応のアダプター", results: [] };
  }

  writeLog(`=== [${siteConfig.id}] 処理開始 ===`);
  let results = [];
  let error = null;
  try {
    results = dedupeResults(await adapter(siteConfig));

    if (results.length === 0) {
      writeLog(`[${siteConfig.id}] 空きなし`);
    } else if (!shouldNotify(siteConfig.id, results)) {
      writeLog(`[${siteConfig.id}] 前回と同じため通知せず`);
    } else {
      const msg = buildMessage(siteConfig.name, results);
      await sendLineMessage(msg);
      saveLastResults(siteConfig.id, results);
      writeLog(`[${siteConfig.id}] 通知送信完了`);
    }
  } catch (err) {
    error = err.message;
    writeLog(`[${siteConfig.id}] エラー発生: ${err.message}`);
    await sendLineMessage(`⚠️【システムエラー】${siteConfig.name}\n${err.message}`);
  }
  writeLog(`=== [${siteConfig.id}] 処理終了 ===`);

  return { id: siteConfig.id, name: siteConfig.name, checkedAt: dayjs().format(), error, results };
}

async function main() {
  cleanOldLogs();

  const previous = loadDashboardData();
  const prevById = new Map((previous?.sites || []).map(s => [s.id, s]));

  const summaries = [];
  // サイトごとに直列実行（同時多重アクセスによる相手サーバーへの負荷を避けるため）
  for (const siteConfig of sites) {
    const summary = await checkOneSite(siteConfig);
    if (summary.error && prevById.has(siteConfig.id)) {
      // 今回のチェックが失敗した場合、ダッシュボード表示は前回の正常な結果を維持する
      summaries.push({ ...prevById.get(siteConfig.id), error: summary.error, lastErrorAt: summary.checkedAt });
    } else {
      summaries.push(summary);
    }
  }

  writeDashboardData(summaries);
}

main();
