import fetch from "node-fetch";
import { writeLog } from "./logger.js";

const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_GROUP_ID = process.env.LINE_GROUP_ID;

export async function sendLineMessage(message) {
  if (!LINE_TOKEN || !LINE_GROUP_ID) {
    writeLog("LINE設定(LINE_TOKEN/LINE_GROUP_ID)が未設定のため通知をスキップしました");
    return;
  }

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LINE_TOKEN}`
      },
      body: JSON.stringify({
        to: LINE_GROUP_ID,
        messages: [{ type: "text", text: message }]
      })
    });
    if (!res.ok) writeLog("LINE通知失敗: " + await res.text());
  } catch (err) {
    writeLog("LINE通知エラー: " + err.message);
  }
}
