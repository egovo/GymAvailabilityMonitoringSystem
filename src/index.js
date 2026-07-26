import "dotenv/config";
import dayjs from "dayjs";
import { cleanOldLogs, writeLog } from "./lib/logger.js";
import { sendLineMessage } from "./lib/line.js";
import { loadLastResults, saveLastResults } from "./lib/state.js";
import { loadDashboardData, writeDashboardData } from "./lib/dashboard.js";
import { appendHistoryEntries } from "./lib/history.js";
import { sites } from "./config/sites.js";
import { checkSite as checkOkegawa } from "./sites/okegawa.js";
import { checkSite as checkHasuda } from "./sites/hasuda.js";
import { checkSite as checkAgeo } from "./sites/ageo.js";

const adapters = { okegawa: checkOkegawa, hasuda: checkHasuda, ageo: checkAgeo };
const DASHBOARD_URL = "https://egovo.github.io/GymAvailabilityMonitoringSystem/";

// 週境界の再訪問等で同じ枠が複数回検出されることがあるため、通知・ダッシュボードに出す前に重複を除く
function dedupeResults(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = resultKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 開始・終了時刻(HH:MM)から空き枠の長さ(分)を計算し、ダッシュボードのフィルタ用に持たせる
function withDuration(results) {
  return results.map(r => {
    const [sh, sm] = r.timeStart.split(":").map(Number);
    const [eh, em] = r.timeEnd.split(":").map(Number);
    return { ...r, durationMinutes: eh * 60 + em - (sh * 60 + sm) };
  });
}

function resultKey(r) {
  return `${r.facilityName}|${r.roomName}|${r.date}|${r.timeStart}|${r.timeEnd}`;
}

function formatSlotLine(r) {
  const d = dayjs(r.date);
  const dow = d.day();
  // このシステムは土日祝のみを対象にしているため、土日以外は必然的に祝日
  const label = dow === 6 ? "土" : dow === 0 ? "日" : "祝";
  return `　${d.format("M/D")}(${label}) ${r.facilityName} ${r.roomName}：${r.timeStart}〜${r.timeEnd}`;
}

// 前回チェック時との差分(追加/削除)のみを通知する。全件を毎回列挙すると
// メッセージが肥大化するうえ内容も把握しづらいため、変化点だけを伝える設計にしている。
function buildDiffMessage(siteName, added, removed) {
  let msg = `🏀 ${siteName}\n`;

  if (added.length > 0) {
    msg += `\n🆕 新たに空きが出ました (${added.length}件)\n`;
    added.forEach(r => {
      msg += formatSlotLine(r) + "\n";
    });
  }

  if (removed.length > 0) {
    msg += `\n🚫 空きがなくなりました (${removed.length}件)\n`;
    removed.forEach(r => {
      msg += formatSlotLine(r) + "\n";
    });
  }

  msg += `\n📊 ダッシュボードで確認: ${DASHBOARD_URL}`;
  return msg;
}

function diffResults(previous, current) {
  const prevKeys = new Set(previous.map(resultKey));
  const currKeys = new Set(current.map(resultKey));
  return {
    added: current.filter(r => !prevKeys.has(resultKey(r))),
    removed: previous.filter(r => !currKeys.has(resultKey(r)))
  };
}

// ダッシュボードの履歴タブに表示する最小限の項目だけを残す(元データを丸ごと持つと肥大化するため)
function slotSummary(r) {
  return { date: r.date, facilityName: r.facilityName, roomName: r.roomName, timeStart: r.timeStart, timeEnd: r.timeEnd };
}

function buildDiffHistoryEvent(siteConfig, added, removed) {
  return {
    id: `${siteConfig.id}-${Date.now()}`,
    type: "diff",
    siteId: siteConfig.id,
    siteName: siteConfig.name,
    timestamp: dayjs().format(),
    added: added.map(slotSummary),
    removed: removed.map(slotSummary)
  };
}

function buildErrorHistoryEvent(siteConfig, message) {
  return {
    id: `${siteConfig.id}-${Date.now()}`,
    type: "error",
    siteId: siteConfig.id,
    siteName: siteConfig.name,
    timestamp: dayjs().format(),
    message
  };
}

// ダッシュボード表示用に、通知の有無に関わらず毎回のチェック結果を返す
async function checkOneSite(siteConfig) {
  const adapter = adapters[siteConfig.adapter];
  if (!adapter) {
    writeLog(`[${siteConfig.id}] 未対応のアダプター: ${siteConfig.adapter}`);
    return { id: siteConfig.id, name: siteConfig.name, checkedAt: dayjs().format(), error: "未対応のアダプター", results: [], historyEvent: null };
  }

  writeLog(`=== [${siteConfig.id}] 処理開始 ===`);
  let results = [];
  let error = null;
  let historyEvent = null;
  try {
    results = withDuration(dedupeResults(await adapter(siteConfig)));
    const previous = loadLastResults(siteConfig.id);

    if (previous === null) {
      // 初回チェックは差分を出しようがないため、件数のみ知らせる
      if (results.length > 0) {
        const msg = `🏀 ${siteConfig.name}\n\n初回チェックで${results.length}件の空き枠を検出しました。\n\n📊 ダッシュボードで確認: ${DASHBOARD_URL}`;
        await sendLineMessage(msg);
        historyEvent = buildDiffHistoryEvent(siteConfig, results, []);
        writeLog(`[${siteConfig.id}] 初回チェック・通知送信完了`);
      } else {
        writeLog(`[${siteConfig.id}] 初回チェック・空きなし`);
      }
    } else {
      const { added, removed } = diffResults(previous, results);
      if (added.length === 0 && removed.length === 0) {
        writeLog(`[${siteConfig.id}] 前回と同じため通知せず`);
      } else {
        await sendLineMessage(buildDiffMessage(siteConfig.name, added, removed));
        historyEvent = buildDiffHistoryEvent(siteConfig, added, removed);
        writeLog(`[${siteConfig.id}] 通知送信完了(追加${added.length}件/削除${removed.length}件)`);
      }
    }

    saveLastResults(siteConfig.id, results);
  } catch (err) {
    error = err.message;
    writeLog(`[${siteConfig.id}] エラー発生: ${err.message}`);
    // エラー時もダッシュボードへ誘導し、詳細はダッシュボード側で確認できるようにする
    await sendLineMessage(`⚠️【システムエラー】${siteConfig.name}\n${err.message}\n\n📊 ダッシュボードで確認: ${DASHBOARD_URL}`);
    historyEvent = buildErrorHistoryEvent(siteConfig, err.message);
  }
  writeLog(`=== [${siteConfig.id}] 処理終了 ===`);

  return { id: siteConfig.id, name: siteConfig.name, checkedAt: dayjs().format(), error, results, historyEvent };
}

async function main() {
  cleanOldLogs();

  const previous = loadDashboardData();
  const prevById = new Map((previous?.sites || []).map(s => [s.id, s]));

  const summaries = [];
  const historyEvents = [];
  // サイトごとに直列実行（同時多重アクセスによる相手サーバーへの負荷を避けるため）
  for (const siteConfig of sites) {
    const { historyEvent, ...summary } = await checkOneSite(siteConfig);
    if (historyEvent) historyEvents.push(historyEvent);

    if (summary.error && prevById.has(siteConfig.id)) {
      // 今回のチェックが失敗した場合、ダッシュボード表示は前回の正常な結果を維持する
      summaries.push({ ...prevById.get(siteConfig.id), error: summary.error, lastErrorAt: summary.checkedAt });
    } else {
      summaries.push(summary);
    }
  }

  writeDashboardData(summaries);
  appendHistoryEntries(historyEvents);
}

main();
