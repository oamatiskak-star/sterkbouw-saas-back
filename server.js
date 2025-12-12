import express from "express"
import dotenv from "dotenv"
import cors from "cors"
import morgan from "morgan"
import { logEvent } from "./utils/log.js"

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())
app.use(morgan("dev"))

app.get("/ping", (req, res) => {
  logEvent("Ping ontvangen")
  res.json({ status: "ok", timestamp: Date.now() })
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  logEvent(`Server draait op poort ${PORT}`)
})