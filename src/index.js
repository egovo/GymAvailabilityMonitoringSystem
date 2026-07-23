import "dotenv/config";
import { cleanOldLogs, writeLog } from "./lib/logger.js";
import { sendLineMessage } from "./lib/line.js";
import { shouldNotify, saveLastResults } from "./lib/state.js";
import { sites } from "./config/sites.js";
import { checkSite as checkOkegawa } from "./sites/okegawa.js";
import { checkSite as checkHasuda } from "./sites/hasuda.js";
import { checkSite as checkAgeo } from "./sites/ageo.js";

const adapters = { okegawa: checkOkegawa, hasuda: checkHasuda, ageo: checkAgeo };

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

async function checkOneSite(siteConfig) {
  const adapter = adapters[siteConfig.adapter];
  if (!adapter) {
    writeLog(`[${siteConfig.id}] 未対応のアダプター: ${siteConfig.adapter}`);
    return;
  }

  writeLog(`=== [${siteConfig.id}] 処理開始 ===`);
  try {
    const results = await adapter(siteConfig);

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
    writeLog(`[${siteConfig.id}] エラー発生: ${err.message}`);
    await sendLineMessage(`⚠️【システムエラー】${siteConfig.name}\n${err.message}`);
  }
  writeLog(`=== [${siteConfig.id}] 処理終了 ===`);
}

async function main() {
  cleanOldLogs();

  // サイトごとに直列実行（同時多重アクセスによる相手サーバーへの負荷を避けるため）
  for (const siteConfig of sites) {
    await checkOneSite(siteConfig);
  }
}

main();
