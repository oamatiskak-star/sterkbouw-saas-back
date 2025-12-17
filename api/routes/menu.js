import express from "express"
import { createClient } from "@supabase/supabase-js"

const router = express.Router()

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
)

/*
GET /api/menu
Header:

x-role: admin | manager | user

Response:

modules

submodules
*/
router.get("/", async (req, res) => {
try {
const roleKey = req.headers["x-role"] || "admin"

const { data: role, error: roleError } = await supabase
.from("roles")
.select("id")
.eq("key", roleKey)
.single()

if (roleError || !role) {
return res.status(403).json({
ok: false,
error: "Ongeldige rol"
})
}

const { data: modules, error: modulesError } = await supabase
.from("modules")
.select( id, key, label, icon, route, sort_order, submodules ( id, key, label, route, sort_order ) )
.eq("active", true)
.order("sort_order", { ascending: true })

if (modulesError) {
throw modulesError
}

const response = (modules || []).map(m => ({
key: m.key,
label: m.label,
icon: m.icon,
route: m.route,
submodules: (m.submodules || [])
.sort((a, b) => a.sort_order - b.sort_order)
.map(s => ({
key: s.key,
label: s.label,
route: s.route
}))
}))

res.json(response)
} catch (err) {
console.error("MENU API ERROR", err)
res.status(500).json({
ok: false,
error: "Menu laden mislukt"
})
}
})

export default router
