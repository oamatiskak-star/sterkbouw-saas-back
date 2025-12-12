import express from 'express'
import { sendTelegram } from '../telegram/telegram.js'

const router = express.Router()

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body
    console.log('[AO] Webhook ontvangen:', payload)
    await sendTelegram(`[AO] Webhook van GitHub:\n${JSON.stringify(payload, null, 2)}`)
    res.status(200).send('Webhook verwerkt')
  } catch (err) {
    await sendTelegram(`[AO] Webhook FOUT: ${err.message}`)
    res.status(500).send('Webhook fout')
  }
})

export default router

