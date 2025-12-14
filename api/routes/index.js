import express from "express"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const router = express.Router()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SKIP = [
  "AO_MISSING_COMPONENTS",
  "backend_full",
  "backend_root",
  "backend_error_handler",
  "backend_logger",
  "database_full",
  "calculatie_full",
  "RouteMap"
]

fs.readdirSync(__dirname, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .forEach(dir => {
    const name = dir.name

    if (SKIP.some(s => name.startsWith(s))) {
      console.log("SKIP module:", name)
      return
    }

    const indexPath = path.join(__dirname, name, "index.js")

    if (!fs.existsSync(indexPath)) {
      console.log("NO INDEX.JS:", name)
      return
    }

    import(`./${name}/index.js`)
      .then(mod => {
        if (!mod.default) {
          console.log("NO ROUTER EXPORT:", name)
          return
        }

        router.use(`/${name}`, mod.default)
        console.log("API module mounted:", `/api/${name}`)
      })
      .catch(err => {
        console.error("FAILED MODULE:", name, err.message)
      })
  })

export default router
