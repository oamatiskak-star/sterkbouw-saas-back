import fetch from "node-fetch"
export default async function sendTelegram(msg){
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if(!token || !chatId) return console.error("Telegram config ontbreekt")
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ chat_id: chatId, text: msg })
  }).then(r => r.json()).then(console.log).catch(console.error)
}
