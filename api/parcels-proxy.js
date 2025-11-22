// Vercel Serverless Function proxy for Package Tracking APIs
// Supporta multiple API providers con fallback automatico:
// 1. ParcelsApp API (https://parcelsapp.com/api-docs/)
// 2. 17Track API (https://www.17track.net/en/api) - Piano gratuito generoso
//
// Configurazione:
// - PARCELS_API_TOKEN: API key per ParcelsApp
// - TRACK17_API_KEY: API key per 17Track (opzionale, usato come fallback)
// - TRACKING_PROVIDER: 'parcelsapp' (default) o '17track' o 'auto' (fallback automatico)
//
// Modalità MOCK: Imposta USE_MOCK_DATA=true per usare dati di test (solo sviluppo)

// Helper function per 17Track API
async function trackWith17Track(trackingNumber, apiKey) {
  const base = 'https://api.17track.net/track/v2.2'
  
  // 17Track API usa POST con array di tracking numbers
  const response = await fetch(`${base}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      '17token': apiKey
    },
    body: JSON.stringify({
      number: trackingNumber
    }),
    signal: AbortSignal.timeout(30000)
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`17Track API error: ${response.status} - ${errorText}`)
  }
  
  const data = await response.json()
  
  // Poi recupera i dati
  const getResponse = await fetch(`${base}/gettrackinfo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      '17token': apiKey
    },
    body: JSON.stringify({
      number: trackingNumber
    }),
    signal: AbortSignal.timeout(30000)
  })
  
  if (!getResponse.ok) {
    const errorText = await getResponse.text()
    throw new Error(`17Track gettrackinfo error: ${getResponse.status} - ${errorText}`)
  }
  
  const trackData = await getResponse.json()
  
  // Normalizza la risposta 17Track al formato ParcelsApp
  if (trackData.data && trackData.data.length > 0) {
    const track = trackData.data[0]
    return {
      done: true,
      shipments: [{
        trackingId: track.number || trackingNumber,
        carrier: {
          name: track.carrier || 'Unknown',
          slug: track.carrier_code || 'unknown'
        },
        status: track.tag || 'unknown',
        origin: track.origin || '',
        destination: track.destination || '',
        events: (track.track || []).map((event, idx) => ({
          id: idx.toString(),
          status: event.tag || 'unknown',
          description: event.checkpoint_status || event.details || '',
          timestamp: event.tracked_time || event.datetime || new Date().toISOString(),
          location: event.location || ''
        }))
      }],
      _meta: {
        done: true,
        fromCache: false,
        provider: '17track'
      }
    }
  }
  
  throw new Error('No tracking data from 17Track')
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    const parcelsApiKey = process.env.PARCELS_API_TOKEN
    const track17ApiKey = process.env.TRACK17_API_KEY
    const provider = process.env.TRACKING_PROVIDER || 'auto' // 'parcelsapp', '17track', o 'auto'
    
    // Forza l'URL corretto anche se è configurato quello vecchio su Vercel
    let parcelsBase = process.env.PARCELS_API_BASE || 'https://parcelsapp.com/api/v3'
    
    // Se l'URL base è quello vecchio, usa quello corretto
    if (parcelsBase === 'https://api.parcelsapp.com' || parcelsBase.includes('api.parcelsapp.com')) {
      console.warn(`[Tracking Proxy] URL base errato rilevato: ${parcelsBase}. Usando URL corretto.`)
      parcelsBase = 'https://parcelsapp.com/api/v3'
    }
    
    // Test endpoint - return detailed configuration status
    if (req.query.test === 'true') {
      const testResult = {
        configured: !!(parcelsApiKey || track17ApiKey),
        provider: provider,
        parcelsApp: {
          configured: !!parcelsApiKey,
          hasToken: !!parcelsApiKey,
          tokenLength: parcelsApiKey ? parcelsApiKey.length : 0,
          baseUrl: parcelsBase
        },
        track17: {
          configured: !!track17ApiKey,
          hasToken: !!track17ApiKey,
          tokenLength: track17ApiKey ? track17ApiKey.length : 0,
          baseUrl: 'https://api.17track.net/track/v2.2'
        },
        message: (parcelsApiKey || track17ApiKey) ? 'Proxy is configured correctly' : 'No API keys configured',
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production',
        apiDocumentation: {
          parcelsapp: 'https://parcelsapp.com/api-docs/',
          track17: 'https://www.17track.net/en/api'
        }
      }
      
      // Test ParcelsApp
      if (parcelsApiKey) {
        try {
          const accountUrl = `${parcelsBase}/account?apiKey=${encodeURIComponent(parcelsApiKey)}`
          const accountResponse = await fetch(accountUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000)
          })
          testResult.parcelsApp.apiReachable = accountResponse.ok || accountResponse.status < 500
          testResult.parcelsApp.apiStatus = accountResponse.status
        } catch (e) {
          testResult.parcelsApp.apiReachable = false
          testResult.parcelsApp.apiError = e.message
        }
      }
      
      return res.status(200).json(testResult)
    }
    
    if (!parcelsApiKey && !track17ApiKey) {
      console.error('No API keys configured')
      return res.status(500).json({ 
        error: 'No API keys configured',
        message: 'Please set PARCELS_API_TOKEN or TRACK17_API_KEY in Vercel environment variables',
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

    // Modalità MOCK per sviluppo/test (solo se esplicitamente abilitata)
    const useMockData = process.env.USE_MOCK_DATA === 'true' && process.env.NODE_ENV !== 'production'
    if (useMockData) {
      console.log('[Tracking Proxy] Using MOCK data mode')
      return res.status(200).json({
        done: true,
        shipments: [{
          trackingId: tracking,
          carrier: { name: 'Mock Carrier', slug: 'mock' },
          status: 'in_transit',
          origin: 'Mock Origin',
          destination: 'Mock Destination',
          events: [
            {
              id: '1',
              status: 'in_transit',
              description: 'Package in transit',
              timestamp: new Date().toISOString(),
              location: 'Mock Location'
            }
          ]
        }],
        _meta: { done: true, fromCache: false, mock: true }
      })
    }

    const destinationCountry = req.query.destinationCountry || req.query.country || ''
    const language = req.query.language || 'en'

    console.log(`[Tracking Proxy] Request for tracking: ${tracking}, Provider: ${provider}`)

    // Se provider è '17track' o 'auto' e ParcelsApp non è disponibile, usa 17Track
    const use17Track = provider === '17track' || (provider === 'auto' && track17ApiKey)
    
    // Prova prima ParcelsApp (se configurato e provider non è solo 17track)
    if (parcelsApiKey && provider !== '17track') {
      try {
        // Step 1: Create tracking request (POST)
        const trackingUrl = `${parcelsBase}/shipments/tracking`
        const trackingPayload = {
          apiKey: parcelsApiKey,
          shipments: [{
            trackingId: tracking,
            ...(destinationCountry && { destinationCountry: destinationCountry })
          }],
          language: language
        }

        console.log(`[Tracking Proxy] Trying ParcelsApp API...`)
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
        console.log(`[Tracking Proxy] ParcelsApp response status: ${createResponse.status}`)

        if (createResponse.ok) {
          let createData
          try {
            createData = JSON.parse(createResponseText)
          } catch (e) {
            throw new Error('Invalid JSON response from ParcelsApp')
          }

          // Controlla se c'è un errore nella risposta
          if (createData.error === 'SUBSCRIPTION_LIMIT_REACHED') {
            console.log(`[Tracking Proxy] ParcelsApp limit reached, trying 17Track fallback...`)
            throw new Error('SUBSCRIPTION_LIMIT_REACHED')
          }

          if (createData.error) {
            // Altri errori di ParcelsApp
            let errorMessage = createData.error
            let hint = ''
            
            if (createData.error === 'INVALID_API_KEY' || createData.error === 'UNAUTHORIZED') {
              errorMessage = 'API Key non valida'
              hint = 'La chiave API ParcelsApp non è valida. Verifica PARCELS_API_TOKEN su Vercel.'
            } else if (createData.error === 'INVALID_TRACKING_ID') {
              errorMessage = 'Tracking ID non valido'
              hint = 'Il codice di tracking inserito non è valido.'
            }
            
            // Se abbiamo 17Track come fallback, provalo
            if (use17Track && track17ApiKey) {
              console.log(`[Tracking Proxy] ParcelsApp error, trying 17Track fallback...`)
              throw new Error('PARCELSAPP_ERROR')
            }
            
            return res.status(400).json({
              error: errorMessage,
              apiError: createData.error,
              details: createData,
              hint: hint || 'Errore dall\'API ParcelsApp.'
            })
          }
          
          // L'UUID potrebbe essere in diversi campi
          const uuid = createData.uuid || createData.id || createData.trackingId || createData.requestId
          if (!uuid) {
            // Se abbiamo 17Track come fallback, provalo
            if (use17Track && track17ApiKey) {
              console.log(`[Tracking Proxy] No UUID from ParcelsApp, trying 17Track fallback...`)
              throw new Error('NO_UUID')
            }
            
            return res.status(500).json({
              error: 'No UUID received from tracking request',
              response: createData,
              responseKeys: Object.keys(createData)
            })
          }
          
          console.log(`[Tracking Proxy] ParcelsApp UUID received: ${uuid}`)

          // Step 2: Get tracking results (GET)
          const getUrl = `${parcelsBase}/shipments/tracking?uuid=${encodeURIComponent(uuid)}&apiKey=${encodeURIComponent(parcelsApiKey)}`
          
          const getResponse = await fetch(getUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(30000)
          })

          const getResponseText = await getResponse.text()

          if (getResponse.ok) {
            let trackingData
            try {
              trackingData = JSON.parse(getResponseText)
            } catch (e) {
              throw new Error('Invalid JSON in tracking results')
            }

            return res.status(200).json({
              ...trackingData,
              uuid: uuid,
              _meta: {
                done: trackingData.done || false,
                fromCache: createData.fromCache || false,
                provider: 'parcelsapp'
              }
            })
          }
        }
      } catch (parcelsError) {
        // Se è SUBSCRIPTION_LIMIT_REACHED e abbiamo 17Track, fallback
        if (parcelsError.message === 'SUBSCRIPTION_LIMIT_REACHED' && use17Track && track17ApiKey) {
          console.log(`[Tracking Proxy] ParcelsApp limit reached, using 17Track fallback`)
        } else if (parcelsError.message !== 'PARCELSAPP_ERROR' && parcelsError.message !== 'NO_UUID') {
          // Se non è un errore che vogliamo gestire con fallback, rilancia
          throw parcelsError
        }
      }
    }

    // Fallback a 17Track se configurato
    if (use17Track && track17ApiKey) {
      try {
        console.log(`[Tracking Proxy] Using 17Track API...`)
        const track17Data = await trackWith17Track(tracking, track17ApiKey)
        return res.status(200).json(track17Data)
      } catch (track17Error) {
        console.error(`[Tracking Proxy] 17Track error:`, track17Error)
        return res.status(500).json({
          error: '17Track API error',
          message: track17Error.message,
          hint: 'Verifica che TRACK17_API_KEY sia configurato correttamente su Vercel. Ottieni una chiave gratuita su https://www.17track.net/en/api'
        })
      }
    }

    // Se arriviamo qui, nessun provider ha funzionato
    return res.status(500).json({
      error: 'No tracking provider available',
      hint: 'Configura almeno PARCELS_API_TOKEN o TRACK17_API_KEY su Vercel'
    })

  } catch (error) {
    console.error('[Tracking Proxy] Unexpected error:', error)
    return res.status(500).json({ 
      error: 'proxy error', 
      message: error.message,
      name: error.name,
      type: 'UnexpectedError',
      hint: 'Errore imprevisto nel proxy. Controlla i log di Vercel per maggiori dettagli.',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}
