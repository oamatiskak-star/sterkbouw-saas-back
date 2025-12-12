import express from 'express'
import { sendTelegram } from '../telegram/telegram.js'

const router = express.Router()

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body
    console.log('[AO] Webhook ontvangen:', payload)

    // Verstuur naar Telegram
    await sendTelegram(`[AO] Webhook ontvangen van Vercel:\n${JSON.stringify(payload, null, 2)}`)

    res.status(200).send('Webhook ontvangen')
  } catch (err) {
    console.error('[AO] Webhook fout:', err.message)
    await sendTelegram(`[AO] Webhook FOUT: ${err.message}`)
    res.status(500).send('Fout bij verwerken webhook')
  }
})

export default router
