import fs from "fs";
import path from "path";

const HISTORY_FILE = "./docs/history.json";
const MAX_ENTRIES = 200; // 件数の上限(肥大化防止の安全弁)
const MAX_AGE_DAYS = 30; // これより古いイベントは表示価値が薄いため間引く

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

// 通知(差分)・エラーのイベントを履歴に追記し、古いものから間引いて保存する
export function appendHistoryEntries(entries) {
  if (!entries || entries.length === 0) return;

  const current = loadHistory();
  const merged = [...entries, ...current];
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const trimmed = merged.filter(e => new Date(e.timestamp).getTime() >= cutoff).slice(0, MAX_ENTRIES);

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}
