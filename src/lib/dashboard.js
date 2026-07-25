import fs from "fs";
import path from "path";
import dayjs from "dayjs";

const DASHBOARD_DATA_FILE = "./docs/data.json";

// 前回のダッシュボードデータを読み込む(サイト単位でエラー時に前回結果を維持するため)
export function loadDashboardData() {
  try {
    return JSON.parse(fs.readFileSync(DASHBOARD_DATA_FILE, "utf8"));
  } catch {
    return null;
  }
}

// 各サイトの最新チェック結果をダッシュボード用JSONとして書き出す
export function writeDashboardData(siteSummaries) {
  const payload = {
    generatedAt: dayjs().format(),
    sites: siteSummaries
  };
  fs.mkdirSync(path.dirname(DASHBOARD_DATA_FILE), { recursive: true });
  fs.writeFileSync(DASHBOARD_DATA_FILE, JSON.stringify(payload, null, 2));
}
