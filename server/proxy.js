// Simple local proxy for testing the Parcels API without exposing the token in the client.
// Usage: set PARCELS_API_TOKEN and optionally PARCELS_API_BASE, then run:
//   node server/proxy.js

const express = require('express')
const fetch = require('node-fetch')
const app = express()
const port = process.env.PORT || 3000

const TOKEN = process.env.PARCELS_API_TOKEN
const BASE = process.env.PARCELS_API_BASE || 'https://api.parcelsapp.com'

if (!TOKEN) {
  console.warn('Warning: PARCELS_API_TOKEN is not set. Set it to use the proxy.')
}

app.get('/parcels', async (req, res) => {
  const tracking = req.query.tracking
  if (!tracking) return res.status(400).json({ error: 'tracking required' })

  // Replace path with actual Parcels API endpoint
  const url = `${BASE}/v1/trackings/${encodeURIComponent(tracking)}`

  try {
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' } })
    const text = await r.text()
    try { return res.status(r.status).json(JSON.parse(text)) }
    catch (e) { return res.status(r.status).send(text) }
  } catch (err) {
    console.error(err)
    res.status(502).json({ error: 'bad gateway', details: err.message })
  }
})

app.listen(port, () => console.log(`Parcels proxy listening at http://localhost:${port}`))
