// Vercel Serverless Function proxy for Parcels API
// This file should be in /api/parcels-proxy.js for Vercel to recognize it as a serverless function

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
    // ParcelsApp API - Documentazione: https://parcelsapp.com/api-docs/
    // URL base dell'API ParcelsApp
    const base = process.env.PARCELS_API_BASE || 'https://parcelsapp.com/api'
    
    // Test endpoint - return detailed configuration status
    if (req.query.test === 'true') {
      const testResult = {
        configured: !!token,
        baseUrl: base,
        hasToken: !!token,
        tokenLength: token ? token.length : 0,
        tokenPrefix: token ? token.substring(0, 10) + '...' : 'N/A',
        message: token ? 'Proxy is configured correctly' : 'PARCELS_API_TOKEN is missing',
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production'
      }
      
      // Try to make a test request if token is available
      if (token) {
        // Prova diversi endpoint possibili per ParcelsApp API
        // Verifica la documentazione su https://parcelsapp.com/api-docs/ per il formato corretto
        const testEndpoints = [
          `${base}/trackings/test123`,
          `${base}/v1/trackings/test123`,
          `${base}/tracking/test123`,
          `${base}/v1/tracking/test123`,
          `${base}/api/trackings/test123`,
          `https://parcelsapp.com/api/trackings/test123`,
          `https://parcelsapp.com/api/v1/trackings/test123`
        ]
        
        testResult.testedEndpoints = []
        
        for (const testUrl of testEndpoints) {
          try {
            console.log(`[Test] Trying endpoint: ${testUrl}`)
            const testResponse = await fetch(testUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
              },
              signal: AbortSignal.timeout(5000) // 5 second timeout
            })
            
            testResult.testedEndpoints.push({
              url: testUrl,
              status: testResponse.status,
              statusText: testResponse.statusText,
              success: testResponse.ok || testResponse.status < 500
            })
            
            // Se otteniamo una risposta (anche 404), significa che l'API è raggiungibile
            if (testResponse.status < 500) {
              testResult.apiReachable = true
              testResult.apiStatus = testResponse.status
              testResult.apiStatusText = testResponse.statusText
              testResult.workingEndpoint = testUrl
              break
            }
          } catch (testErr) {
            testResult.testedEndpoints.push({
              url: testUrl,
              error: testErr.message,
              code: testErr.code,
              name: testErr.name
            })
            
            // Se è un errore di DNS o connessione, salva i dettagli
            if (testErr.code === 'ENOTFOUND' || testErr.code === 'ECONNREFUSED' || testErr.name === 'TypeError') {
              testResult.apiReachable = false
              testResult.apiError = testErr.message
              testResult.apiErrorCode = testErr.code
              testResult.apiErrorName = testErr.name
            }
          }
        }
        
        // Se nessun endpoint ha funzionato, prova a fare un ping base
        if (!testResult.apiReachable) {
          try {
            // Prova a fare una richiesta base all'URL senza path
            const baseTest = await fetch(base, {
              method: 'GET',
              signal: AbortSignal.timeout(3000)
            })
            testResult.baseUrlReachable = true
            testResult.baseUrlStatus = baseTest.status
          } catch (baseErr) {
            testResult.baseUrlReachable = false
            testResult.baseUrlError = baseErr.message
            testResult.baseUrlErrorCode = baseErr.code
          }
        }
      }
      
      return res.status(200).json(testResult)
    }
    
    if (!token) {
      console.error('PARCELS_API_TOKEN not set in environment variables')
      return res.status(500).json({ 
        error: 'PARCELS_API_TOKEN not configured',
        message: 'Please set PARCELS_API_TOKEN in Vercel environment variables',
        hint: 'Go to Vercel Dashboard → Project Settings → Environment Variables',
        debug: {
          envKeys: Object.keys(process.env).filter(k => k.includes('PARCELS') || k.includes('API'))
        }
      })
    }

    const tracking = req.query.tracking
    if (!tracking) {
      return res.status(400).json({ 
        error: 'tracking query parameter required',
        usage: 'Use ?tracking=YOUR_TRACKING_CODE'
      })
    }

    // Construct the ParcelsApp API URL
    // Documentazione: https://parcelsapp.com/api-docs/
    // Prova diversi formati di endpoint possibili
    const possibleEndpoints = [
      `${base}/trackings/${encodeURIComponent(tracking)}`,
      `${base}/v1/trackings/${encodeURIComponent(tracking)}`,
      `${base}/tracking/${encodeURIComponent(tracking)}`,
      `${base}/v1/tracking/${encodeURIComponent(tracking)}`,
      `https://parcelsapp.com/api/trackings/${encodeURIComponent(tracking)}`,
      `https://parcelsapp.com/api/v1/trackings/${encodeURIComponent(tracking)}`
    ]

    console.log(`[Parcels Proxy] Request for tracking: ${tracking}`)
    console.log(`[Parcels Proxy] Base URL: ${base}`)
    console.log(`[Parcels Proxy] Token present: ${!!token}`)

    // Try the first endpoint (most common)
    const apiUrl = possibleEndpoints[0]
    console.log(`[Parcels Proxy] Attempting: ${apiUrl}`)

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Parcels-Proxy/1.0'
        },
        signal: AbortSignal.timeout(30000) // 30 second timeout
      })

      const responseText = await response.text()
      console.log(`[Parcels Proxy] Response status: ${response.status}`)
      console.log(`[Parcels Proxy] Response length: ${responseText.length}`)

      if (!response.ok) {
        let errorData
        try {
          errorData = JSON.parse(responseText)
        } catch (e) {
          errorData = { raw: responseText.substring(0, 500) }
        }

        return res.status(response.status).json({
          error: 'Parcels API error',
          status: response.status,
          statusText: response.statusText,
          details: errorData,
          url: apiUrl,
          headers: Object.fromEntries(response.headers.entries())
        })
      }

      // Try to parse as JSON
      try {
        const jsonData = JSON.parse(responseText)
        return res.status(200).json(jsonData)
      } catch (parseError) {
        // If not JSON, return as text
        return res.status(200).send(responseText)
      }

    } catch (fetchError) {
      console.error('[Parcels Proxy] Fetch error:', fetchError)
      
      // If first endpoint fails, try others
      if (fetchError.name === 'AbortError' || fetchError.code === 'ENOTFOUND' || fetchError.code === 'ECONNREFUSED') {
        return res.status(502).json({
          error: 'proxy error',
          details: fetchError.message,
          code: fetchError.code,
          url: apiUrl,
          hint: 'The API endpoint might be incorrect or unreachable. Check PARCELS_API_BASE environment variable.',
          triedUrl: apiUrl
        })
      }

      return res.status(502).json({
        error: 'proxy error',
        details: fetchError.message,
        code: fetchError.code,
        name: fetchError.name,
        url: apiUrl,
        hint: 'Check that PARCELS_API_TOKEN and PARCELS_API_BASE are correctly set in Vercel environment variables'
      })
    }

  } catch (error) {
    console.error('[Parcels Proxy] Unexpected error:', error)
    return res.status(500).json({ 
      error: 'proxy error', 
      details: error.message,
      name: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}
