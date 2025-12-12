import * as dotenv from 'dotenv'
dotenv.config()

import axios from 'axios'
import express from 'express'
import { sendTelegram } from './telegram/telegram.js'
import webhookRouter from './routes/webhook.js'

const backendUrl = process.env.BACKEND_URL

async function pingBackend() {
  try {
    const response = await axios.get(`${backendUrl}/ping`)
    const msg = `[AO] Backend reageert: ${response.status} - ${response.statusText}`
    console.log(msg)
    await sendTelegram(msg)
  } catch (error) {
    const errMsg = `[AO] FOUT bij ping backend: ${error.message}`
    console.error(errMsg)
    await sendTelegram(errMsg)
  }
}

console.log('[AO] Agent gestart')
await sendTelegram('[AO] Agent gestart en probeert backend te pingen...')
await pingBackend()

// Webhook server
const app = express()
app.use(express.json())
app.use('/api', webhookRouter)

const PORT = process.env.PORT || 10000
app.listen(PORT, () => {
  console.log(`[AO] Webhook actief op poort ${PORT}`)
})
