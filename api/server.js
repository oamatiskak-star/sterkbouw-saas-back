import express from "express"
import dotenv from "dotenv"
dotenv.config()
import sendTelegram from "../ao_notifications/sendTelegram.js"

const app = express()
app.use(express.json())

app.get("/", (req, res) => res.send("SterkBouw backend draait"))
app.get("/ping", async (req, res) => {
  await sendTelegram("✅ Ping vanuit SterkBouw backend");
  res.json({ ok: true });
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log("Backend draait op poort " + PORT))
