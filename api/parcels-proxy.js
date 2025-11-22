// Vercel Serverless Function proxy for Parcels API
// This file should be in /api/parcels-proxy.js for Vercel to recognize it as a serverless function

const https = require('https')
const { URL } = require('url')

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const token = process.env.PARCELS_API_TOKEN
    const base = process.env.PARCELS_API_BASE || 'https://api.parcelsapp.com'
    
    // Test endpoint - return configuration status
    if (req.query.test === 'true') {
      return res.status(200).json({
        configured: !!token,
        baseUrl: base,
        hasToken: !!token,
        message: token ? 'Proxy is configured correctly' : 'PARCELS_API_TOKEN is missing'
      })
    }
    
    if (!token) {
      console.error('PARCELS_API_TOKEN not set in environment variables')
      return res.status(500).json({ 
        error: 'PARCELS_API_TOKEN not configured',
        message: 'Please set PARCELS_API_TOKEN in Vercel environment variables',
        hint: 'Go to Vercel Dashboard → Project Settings → Environment Variables'
      })
    }

    const tracking = req.query.tracking
    if (!tracking) {
      return res.status(400).json({ 
        error: 'tracking query parameter required',
        usage: 'Use ?tracking=YOUR_TRACKING_CODE'
      })
    }

    // Construct the Parcels API URL
    // Adjust the endpoint path based on the actual Parcels API documentation
    const apiUrl = `${base}/v1/trackings/${encodeURIComponent(tracking)}`
    const urlObj = new URL(apiUrl)

    console.log(`Proxying request to: ${apiUrl}`)

    // Use https.request for maximum compatibility
    return new Promise((resolve, reject) => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'User-Agent': 'Parcels-Proxy/1.0'
        }
      }

      const proxyReq = https.request(options, (proxyRes) => {
        let body = ''
        
        proxyRes.on('data', (chunk) => {
          body += chunk
        })
        
        proxyRes.on('end', () => {
          const statusCode = proxyRes.statusCode || 200
          
          // Handle different HTTP status codes
          if (statusCode >= 400) {
            console.error(`Parcels API returned error ${statusCode}:`, body.substring(0, 500))
            try {
              const errorData = JSON.parse(body)
              return res.status(statusCode).json({
                error: 'Parcels API error',
                status: statusCode,
                details: errorData
              })
            } catch (e) {
              return res.status(statusCode).json({
                error: 'Parcels API error',
                status: statusCode,
                details: body.substring(0, 500)
              })
            }
          }
          
          try {
            // Try to parse as JSON
            const jsonData = JSON.parse(body)
            res.status(statusCode).json(jsonData)
            resolve()
          } catch (parseError) {
            // If not JSON, return as text
            res.status(statusCode).send(body)
            resolve()
          }
        })
      })

      proxyReq.on('error', (err) => {
        console.error('Proxy request error:', err)
        res.status(502).json({ 
          error: 'proxy error', 
          details: err.message,
          hint: 'Check that PARCELS_API_TOKEN and PARCELS_API_BASE are correctly set in Vercel environment variables'
        })
        resolve()
      })

      proxyReq.setTimeout(30000, () => {
        proxyReq.destroy()
        res.status(504).json({ error: 'Request timeout' })
        resolve()
      })

      proxyReq.end()
    })

  } catch (error) {
    console.error('Proxy error:', error)
    return res.status(500).json({ 
      error: 'proxy error', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}
