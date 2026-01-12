import axios from 'axios'
import dotenv from 'dotenv'
dotenv.config()

const token = process.env.TELEGRAM_BOT_TOKEN
const chatId = process.env.TELEGRAM_CHAT_ID
let authWarningShown = false
let authDisabled = false

export async function sendTelegram(message) {
  if (authDisabled) return

  if (!token || !chatId) {
    if (!authWarningShown) {
      console.warn("[TELEGRAM] Token of chatId ontbreekt; bericht wordt niet verstuurd.")
      authWarningShown = true
    }
    return
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`

  try {
    await axios.post(
      url,
      {
        chat_id: chatId,
        text: message
      },
      { timeout: 5000 }
    )
  } catch (error) {
    const status = error.response?.status
    const description = error.response?.data?.description || error.message

    if (status === 401 && !authWarningShown) {
      console.warn("[TELEGRAM] Autorisatie gefaald (401). Controleer TELEGRAM_BOT_TOKEN en TELEGRAM_CHAT_ID.")
      authWarningShown = true
      authDisabled = true
    } else {
      console.warn(`[TELEGRAM] Fout bij verzenden: ${description}`)
    }
    // Swallow the error to avoid crashing the app on notification failures
  }
}
