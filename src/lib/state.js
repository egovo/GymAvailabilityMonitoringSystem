import fs from "fs";
import path from "path";
import { writeLog } from "./logger.js";

const STATE_DIR = "./data/state";

function stateFile(siteId) {
  return path.join(STATE_DIR, `${siteId}.json`);
}

export function loadLastResults(siteId) {
  const file = stateFile(siteId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function saveLastResults(siteId, results) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile(siteId), JSON.stringify(results, null, 2));
  writeLog(`[${siteId}] 前回データ保存`);
}

export function shouldNotify(siteId, current) {
  const last = loadLastResults(siteId);
  if (!last) return true;
  return JSON.stringify(current) !== JSON.stringify(last);
}

// 週単位の空き状況フィンガープリント（部屋+週の粒度でキャッシュし、
// 変化のない週はPlaywrightでの時間帯詳細取得をスキップするために使う）
const FINGERPRINT_DIR = "./data/state/fingerprints";

function fingerprintFile(siteId) {
  return path.join(FINGERPRINT_DIR, `${siteId}.json`);
}

export function loadFingerprints(siteId) {
  const file = fingerprintFile(siteId);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function saveFingerprints(siteId, fingerprints) {
  if (!fs.existsSync(FINGERPRINT_DIR)) fs.mkdirSync(FINGERPRINT_DIR, { recursive: true });
  fs.writeFileSync(fingerprintFile(siteId), JSON.stringify(fingerprints, null, 2));
}
