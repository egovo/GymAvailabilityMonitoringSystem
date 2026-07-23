import dayjs from "dayjs";
import axios from "axios";

// 祝日API（内閣府データを利用した非公式API）
async function getHolidays(writeLog) {
  try {
    const res = await axios.get("https://holidays-jp.github.io/api/v1/date.json");
    return Object.keys(res.data);
  } catch (e) {
    writeLog?.("祝日取得に失敗 → 土日のみで実行");
    return [];
  }
}

// 今日から指定ヶ月先までの土日祝日の一覧を返す
export async function getTargetDates(months, writeLog) {
  const holidays = await getHolidays(writeLog);
  const today = dayjs();
  const end = today.add(months, "month");

  const dates = [];
  let d = today;

  while (d.isBefore(end) || d.isSame(end, "day")) {
    const dow = d.day();
    const dateStr = d.format("YYYY-MM-DD");

    if (dow === 0 || dow === 6 || holidays.includes(dateStr)) {
      dates.push(dateStr);
    }
    d = d.add(1, "day");
  }

  return { dates, holidays };
}

const YOUBI = ["日", "月", "火", "水", "木", "金", "土"];

export function formatDateLabel(dateStr, holidays) {
  const date = new Date(dateStr);
  const dow = YOUBI[date.getDay()];
  const isHoliday = holidays.includes(dateStr);
  return `${dateStr} (${dow}${isHoliday ? "・祝" : ""})`;
}

// dateStrが属する週の月曜日(YYYY-MM-DD)を返す。週単位でまとめて処理するサイト向け
export function startOfWeek(dateStr) {
  const d = dayjs(dateStr);
  const dow = d.day(); // 0=日
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return d.add(diffToMonday, "day").format("YYYY-MM-DD");
}
