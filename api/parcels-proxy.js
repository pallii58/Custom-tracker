// Vercel Serverless Function proxy for ParcelsApp API
// Documentazione: https://parcelsapp.com/api-docs/
// API funziona in 2 fasi:
// 1. POST /shipments/tracking per creare richiesta e ottenere UUID
// 2. GET /shipments/tracking?uuid=<UUID>&apiKey=<KEY> per leggere risultati

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    const apiKey = process.env.PARCELS_API_TOKEN
    // Forza l'URL corretto anche se è configurato quello vecchio su Vercel
    let base = process.env.PARCELS_API_BASE || 'https://parcelsapp.com/api/v3'
    
    // Se l'URL base è quello vecchio, usa quello corretto
    if (base === 'https://api.parcelsapp.com' || base.includes('api.parcelsapp.com')) {
      console.warn(`[Parcels Proxy] URL base errato rilevato: ${base}. Usando URL corretto.`)
      base = 'https://parcelsapp.com/api/v3'
    }
    
    // Test endpoint - return detailed configuration status
    if (req.query.test === 'true') {
      const testResult = {
        configured: !!apiKey,
        baseUrl: base,
        hasToken: !!apiKey,
        tokenLength: apiKey ? apiKey.length : 0,
        tokenPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'N/A',
        message: apiKey ? 'Proxy is configured correctly' : 'PARCELS_API_TOKEN is missing',
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production',
        apiDocumentation: 'https://parcelsapp.com/api-docs/',
        correctBaseUrl: 'https://parcelsapp.com/api/v3',
        isBaseUrlCorrect: base === 'https://parcelsapp.com/api/v3'
      }
      
      // Avviso se l'URL base non è corretto
      if (!testResult.isBaseUrlCorrect) {
        testResult.warning = `URL base non corretto! Dovrebbe essere 'https://parcelsapp.com/api/v3' ma è '${base}'. Aggiorna PARCELS_API_BASE su Vercel o rimuovilo per usare il default.`
      }
      
      // Try to test account endpoint
      if (apiKey) {
        try {
          const accountUrl = `${base}/account?apiKey=${encodeURIComponent(apiKey)}`
          console.log(`[Test] Testing account endpoint: ${accountUrl}`)
          
          const accountResponse = await fetch(accountUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000) // 10 second timeout
          })
          
          const responseText = await accountResponse.text()
          console.log(`[Test] Account response status: ${accountResponse.status}`)
          console.log(`[Test] Account response: ${responseText.substring(0, 200)}`)
          
          if (accountResponse.ok) {
            try {
              const accountData = JSON.parse(responseText)
              testResult.apiReachable = true
              testResult.apiStatus = accountResponse.status
              testResult.accountInfo = accountData
            } catch (parseErr) {
              testResult.apiReachable = true
              testResult.apiStatus = accountResponse.status
              testResult.apiStatusText = accountResponse.statusText
              testResult.rawResponse = responseText.substring(0, 500)
            }
          } else {
            testResult.apiReachable = true // API è raggiungibile anche se errore
            testResult.apiStatus = accountResponse.status
            testResult.apiStatusText = accountResponse.statusText
            testResult.rawResponse = responseText.substring(0, 500)
          }
        } catch (testErr) {
          console.error(`[Test] Error testing account endpoint:`, testErr)
          testResult.apiReachable = false
          testResult.apiError = testErr.message
          testResult.apiErrorCode = testErr.code
          testResult.apiErrorName = testErr.name
          testResult.errorStack = testErr.stack?.substring(0, 500)
          
          // Prova anche a testare se l'URL base è raggiungibile
          try {
            const baseTest = await fetch(base, {
              method: 'GET',
              signal: AbortSignal.timeout(5000)
            })
            testResult.baseUrlReachable = true
            testResult.baseUrlStatus = baseTest.status
          } catch (baseErr) {
            testResult.baseUrlReachable = false
            testResult.baseUrlError = baseErr.message
          }
        }
      }
      
      return res.status(200).json(testResult)
    }
    
    if (!apiKey) {
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
        usage: 'Use ?tracking=YOUR_TRACKING_CODE&destinationCountry=COUNTRY (optional)'
      })
    }

    const destinationCountry = req.query.destinationCountry || req.query.country || ''
    const language = req.query.language || 'en'

    console.log(`[Parcels Proxy] Request for tracking: ${tracking}`)
    console.log(`[Parcels Proxy] Base URL: ${base}`)
    console.log(`[Parcels Proxy] API Key present: ${!!apiKey}`)

    try {
      // Step 1: Create tracking request (POST)
      const trackingUrl = `${base}/shipments/tracking`
      const trackingPayload = {
        apiKey: apiKey,
        shipments: [
          {
            trackingId: tracking,
            ...(destinationCountry && { destinationCountry: destinationCountry })
          }
        ],
        language: language
      }

      console.log(`[Parcels Proxy] Creating tracking request...`)
      const createResponse = await fetch(trackingUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(trackingPayload),
        signal: AbortSignal.timeout(30000)
      })

      const createResponseText = await createResponse.text()
      console.log(`[Parcels Proxy] Create response status: ${createResponse.status}`)

      if (!createResponse.ok) {
        let errorData
        try {
          errorData = JSON.parse(createResponseText)
        } catch (e) {
          errorData = { raw: createResponseText.substring(0, 500) }
        }

        return res.status(createResponse.status).json({
          error: 'Failed to create tracking request',
          status: createResponse.status,
          statusText: createResponse.statusText,
          details: errorData
        })
      }

      let createData
      try {
        createData = JSON.parse(createResponseText)
      } catch (e) {
        return res.status(500).json({
          error: 'Invalid response from API',
          details: createResponseText.substring(0, 500)
        })
      }

      const uuid = createData.uuid
      if (!uuid) {
        return res.status(500).json({
          error: 'No UUID received from tracking request',
          response: createData
        })
      }

      console.log(`[Parcels Proxy] Tracking request created, UUID: ${uuid}`)

      // Step 2: Get tracking results (GET)
      // Try to get results immediately (might be cached)
      const getUrl = `${base}/shipments/tracking?uuid=${encodeURIComponent(uuid)}&apiKey=${encodeURIComponent(apiKey)}`
      
      console.log(`[Parcels Proxy] Fetching tracking results...`)
      const getResponse = await fetch(getUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(30000)
      })

      const getResponseText = await getResponse.text()
      console.log(`[Parcels Proxy] Get response status: ${getResponse.status}`)

      if (!getResponse.ok) {
        let errorData
        try {
          errorData = JSON.parse(getResponseText)
        } catch (e) {
          errorData = { raw: getResponseText.substring(0, 500) }
        }

        return res.status(getResponse.status).json({
          error: 'Failed to get tracking results',
          status: getResponse.status,
          statusText: getResponse.statusText,
          details: errorData,
          uuid: uuid
        })
      }

      let trackingData
      try {
        trackingData = JSON.parse(getResponseText)
      } catch (e) {
        return res.status(500).json({
          error: 'Invalid response from API',
          details: getResponseText.substring(0, 500),
          uuid: uuid
        })
      }

      // Return tracking data
      // Note: If done=false, the client might need to poll again
      return res.status(200).json({
        ...trackingData,
        uuid: uuid,
        _meta: {
          done: trackingData.done || false,
          fromCache: createData.fromCache || false
        }
      })

    } catch (fetchError) {
      console.error('[Parcels Proxy] Fetch error:', fetchError)
      
      return res.status(502).json({
        error: 'proxy error',
        details: fetchError.message,
        code: fetchError.code,
        name: fetchError.name,
        hint: 'Check that PARCELS_API_TOKEN is correctly set in Vercel environment variables'
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
