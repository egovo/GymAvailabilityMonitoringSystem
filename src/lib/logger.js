import dayjs from "dayjs";
import fs from "fs";
import path from "path";

const LOG_DIR = "./logs";

export function writeLog(message) {
  const now = dayjs();
  const logFile = path.join(LOG_DIR, `log_${now.format("YYYY-MM-DD")}.txt`);
  const line = `[${now.format("YYYY-MM-DD HH:mm:ss")}] ${message}\n`;

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  fs.appendFileSync(logFile, line);
  console.log(message);
}

// 7日より前のログファイルを削除する
export function cleanOldLogs() {
  if (!fs.existsSync(LOG_DIR)) return;

  const files = fs.readdirSync(LOG_DIR);
  const limitDay = dayjs().subtract(7, "day");

  files.forEach(file => {
    const m = file.match(/log_(\d{4}-\d{2}-\d{2})\.txt/);
    if (!m) return;

    const date = dayjs(m[1]);
    if (date.isBefore(limitDay)) {
      fs.unlinkSync(path.join(LOG_DIR, file));
      console.log(`古いログ削除: ${file}`);
    }
  });
}
