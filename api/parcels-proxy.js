// Vercel / Netlify Functions style proxy (Node.js)
// Place this file under /api for Vercel. It forwards requests to the Parcels API
// and injects the secret token from env (PARCELS_API_TOKEN). This keeps your
// token out of the client bundle.

// NOTE: You must replace `PARCELS_API_BASE` and endpoint path with the actual
// Parcels API path(s). I used a placeholder below because the public docs
// endpoint path was not provided in the repository.

const https = require('https')

module.exports = async (req, res) => {
  try {
    // Prefer environment variable (secure). If not set, try to read a local
    // server-side secrets file for quick testing (server/secrets.js).
    // IMPORTANT: do NOT commit server/secrets.js to your repo.
    let token = process.env.PARCELS_API_TOKEN
    let base = process.env.PARCELS_API_BASE || 'https://api.parcelsapp.com'
    try {
      const secrets = require('../server/secrets')
      token = token || secrets.PARCELS_API_TOKEN
      base = base || secrets.PARCELS_API_BASE
    } catch (e) {
      // no local secrets file, continue
    }

    if (!token) return res.status(500).json({ error: 'PARCELS_API_TOKEN not set' })

    const tracking = req.query.tracking
    if (!tracking) return res.status(400).json({ error: 'tracking query parameter required' })

    // Replace the path below with the real Parcels API path for tracking lookup.
    // Example placeholder: `${base}/v1/trackings/${tracking}`
    const path = new URL(`${base}/v1/trackings/${encodeURIComponent(tracking)}`)

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    }

    const proxyReq = https.request(path, options, (proxyRes) => {
      let body = ''
      proxyRes.on('data', (chunk) => body += chunk)
      proxyRes.on('end', () => {
        res.statusCode = proxyRes.statusCode || 200
        // try to parse JSON, otherwise return raw body
        try { return res.json(JSON.parse(body)) }
        catch (e) { return res.send(body) }
      })
    })

    proxyReq.on('error', (err) => {
      console.error('Proxy error', err)
      res.status(502).json({ error: 'proxy error', details: err.message })
    })

    proxyReq.end()
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message || String(e) })
  }
}
// Vercel / Netlify Functions style proxy (Node.js)
// Place this file under /api for Vercel. It forwards requests to the Parcels API
// and injects the secret token from env (PARCELS_API_TOKEN). This keeps your
// token out of the client bundle.

// NOTE: You must replace `PARCELS_API_BASE` and endpoint path with the actual
// Parcels API path(s). I used a placeholder below because the public docs
// endpoint path was not provided in the repository.

const https = require('https')

module.exports = async (req, res) => {
  try {
    const token = process.env.PARCELS_API_TOKEN
    const base = process.env.PARCELS_API_BASE || 'https://api.parcelsapp.com'
    if (!token) return res.status(500).json({ error: 'PARCELS_API_TOKEN not set' })

    const tracking = req.query.tracking
    if (!tracking) return res.status(400).json({ error: 'tracking query parameter required' })

    // Replace the path below with the real Parcels API path for tracking lookup.
    // Example placeholder: `${base}/v1/trackings/${tracking}`
    const path = new URL(`${base}/v1/trackings/${encodeURIComponent(tracking)}`)

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    }

    const proxyReq = https.request(path, options, (proxyRes) => {
      let body = ''
      proxyRes.on('data', (chunk) => body += chunk)
      proxyRes.on('end', () => {
        res.statusCode = proxyRes.statusCode || 200
        // try to parse JSON, otherwise return raw body
        try { return res.json(JSON.parse(body)) }
        catch (e) { return res.send(body) }
      })
    })

    proxyReq.on('error', (err) => {
      console.error('Proxy error', err)
      res.status(502).json({ error: 'proxy error', details: err.message })
    })

    proxyReq.end()
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message || String(e) })
  }
}
