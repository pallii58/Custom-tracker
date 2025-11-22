// Vercel Serverless Function proxy for Package Tracking APIs
// Supporta multiple API providers con fallback automatico:
// 1. ParcelsApp API (https://parcelsapp.com/api-docs/)
// 2. TrackingMore API (https://www.trackingmore.com/tracking-api) - Piano gratuito generoso
// 3. UPS Tracking API (https://developer.ups.com) - Richiede registrazione gratuita
// 4. 17Track API (https://www.17track.net/en/api) - Piano gratuito generoso
//
// Configurazione:
// - PARCELS_API_TOKEN: API key per ParcelsApp
// - TRACKINGMORE_API_KEY: API key per TrackingMore (opzionale, usato come fallback)
// - UPS_ACCESS_KEY: Access Key per UPS API
// - UPS_USER_ID: User ID per UPS API
// - UPS_PASSWORD: Password per UPS API
// - TRACK17_API_KEY: API key per 17Track (opzionale, usato come fallback)
// - TRACKING_PROVIDER: 'parcelsapp' (default) o 'trackingmore' o 'ups' o '17track' o 'auto' (fallback automatico)
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

// Helper function per TrackingMore API
async function trackWithTrackingMore(trackingNumber, apiKey, carrierCode = '') {
  const base = 'https://api.trackingmore.com/v4'
  
  // TrackingMore API v4 - Crea tracking
  const createResponse = await fetch(`${base}/trackings/post`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Tracking-Api-Key': apiKey
    },
    body: JSON.stringify({
      tracking_number: trackingNumber,
      ...(carrierCode && { carrier_code: carrierCode })
    }),
    signal: AbortSignal.timeout(30000)
  })
  
  if (!createResponse.ok) {
    const errorText = await createResponse.text()
    throw new Error(`TrackingMore API error: ${createResponse.status} - ${errorText}`)
  }
  
  const createData = await createResponse.json()
  
  // Se la risposta contiene già i dati, restituiscili
  if (createData.data) {
    const track = createData.data
    return {
      done: true,
      shipments: [{
        trackingId: track.tracking_number || trackingNumber,
        carrier: {
          name: track.carrier_code || 'Unknown',
          slug: track.carrier_code || 'unknown'
        },
        status: track.current_status || 'unknown',
        origin: track.origin || '',
        destination: track.destination || '',
        events: (track.origin_info?.trackinfo || []).map((event, idx) => ({
          id: idx.toString(),
          status: event.status || 'unknown',
          description: event.details || event.checkpoint_status || '',
          timestamp: event.checkpoint_time || event.datetime || new Date().toISOString(),
          location: event.location || ''
        }))
      }],
      _meta: {
        done: true,
        fromCache: false,
        provider: 'trackingmore'
      }
    }
  }
  
  // Se non ci sono dati, prova a recuperarli
  const getResponse = await fetch(`${base}/trackings/get?tracking_number=${encodeURIComponent(trackingNumber)}`, {
    method: 'GET',
    headers: {
      'Tracking-Api-Key': apiKey
    },
    signal: AbortSignal.timeout(30000)
  })
  
  if (!getResponse.ok) {
    const errorText = await getResponse.text()
    throw new Error(`TrackingMore get error: ${getResponse.status} - ${errorText}`)
  }
  
  const trackData = await getResponse.json()
  
  if (trackData.data) {
    const track = trackData.data
    return {
      done: true,
      shipments: [{
        trackingId: track.tracking_number || trackingNumber,
        carrier: {
          name: track.carrier_code || 'Unknown',
          slug: track.carrier_code || 'unknown'
        },
        status: track.current_status || 'unknown',
        origin: track.origin || '',
        destination: track.destination || '',
        events: (track.origin_info?.trackinfo || []).map((event, idx) => ({
          id: idx.toString(),
          status: event.status || 'unknown',
          description: event.details || event.checkpoint_status || '',
          timestamp: event.checkpoint_time || event.datetime || new Date().toISOString(),
          location: event.location || ''
        }))
      }],
      _meta: {
        done: true,
        fromCache: false,
        provider: 'trackingmore'
      }
    }
  }
  
  throw new Error('No tracking data from TrackingMore')
}

// Helper function per UPS Tracking API
async function trackWithUPS(trackingNumber, accessKey, userId, password) {
  // UPS usa OAuth 2.0 - prima otteniamo il token usando Basic Auth
  // Usa endpoint di test (wwwcie) o produzione (onlinetools) in base all'ambiente
  const useProduction = process.env.UPS_USE_PRODUCTION === 'true'
  const oauthUrl = useProduction 
    ? 'https://onlinetools.ups.com/security/v1/oauth/token'
    : 'https://wwwcie.ups.com/security/v1/oauth/token'
  const trackingUrl = useProduction
    ? 'https://onlinetools.ups.com/api/track/v1/details'
    : 'https://wwwcie.ups.com/api/track/v1/details'
  
  // Step 1: Ottieni OAuth token usando Basic Auth
  // UPS richiede Basic Auth con Access Key come username e Secret come password
  // Ma qui usiamo User ID e Password come credenziali Basic Auth
  const basicAuth = Buffer.from(`${userId}:${password}`).toString('base64')
  
  const oauthResponse = await fetch(oauthUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
      'x-merchant-id': accessKey
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials'
    }),
    signal: AbortSignal.timeout(30000)
  })
  
  if (!oauthResponse.ok) {
    const errorText = await oauthResponse.text()
    throw new Error(`UPS OAuth error: ${oauthResponse.status} - ${errorText}`)
  }
  
  const oauthData = await oauthResponse.json()
  const accessToken = oauthData.access_token
  
  if (!accessToken) {
    throw new Error('No access token from UPS OAuth')
  }
  
  // Step 2: Usa il token per ottenere i dati di tracking
  const trackingResponse = await fetch(`${trackingUrl}/${trackingNumber}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'transId': `TRACK${Date.now()}`,
      'transactionSrc': 'custom-tracker'
    },
    signal: AbortSignal.timeout(30000)
  })
  
  if (!trackingResponse.ok) {
    const errorText = await trackingResponse.text()
    throw new Error(`UPS Tracking API error: ${trackingResponse.status} - ${errorText}`)
  }
  
  const trackData = await trackingResponse.json()
  
  // Normalizza la risposta UPS al formato ParcelsApp
  if (trackData.trackResponse && trackData.trackResponse.shipment) {
    const shipment = trackData.trackResponse.shipment[0]
    const packageData = shipment.package[0]
    const activity = packageData.activity || []
    
    return {
      done: true,
      shipments: [{
        trackingId: packageData.trackingNumber || trackingNumber,
        carrier: {
          name: 'UPS',
          slug: 'ups'
        },
        status: packageData.currentStatus?.status?.description || 'unknown',
        origin: shipment.shipper?.address?.city || '',
        destination: shipment.shipTo?.address?.city || '',
        events: activity.map((event, idx) => ({
          id: idx.toString(),
          status: event.status?.status || 'unknown',
          description: event.status?.description || event.status?.type || '',
          timestamp: event.date || new Date().toISOString(),
          location: event.location?.address?.city || event.location?.address?.stateProvince || ''
        }))
      }],
      _meta: {
        done: true,
        fromCache: false,
        provider: 'ups'
      }
    }
  }
  
  throw new Error('No tracking data from UPS')
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
    const trackingMoreApiKey = process.env.TRACKINGMORE_API_KEY
    const upsAccessKey = process.env.UPS_ACCESS_KEY
    const upsUserId = process.env.UPS_USER_ID
    const upsPassword = process.env.UPS_PASSWORD
    const track17ApiKey = process.env.TRACK17_API_KEY
    const provider = process.env.TRACKING_PROVIDER || 'auto' // 'parcelsapp', 'trackingmore', 'ups', '17track', o 'auto'
    
    const upsConfigured = !!(upsAccessKey && upsUserId && upsPassword)
    
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
        configured: !!(parcelsApiKey || trackingMoreApiKey || upsConfigured || track17ApiKey),
        provider: provider,
        parcelsApp: {
          configured: !!parcelsApiKey,
          hasToken: !!parcelsApiKey,
          tokenLength: parcelsApiKey ? parcelsApiKey.length : 0,
          baseUrl: parcelsBase
        },
        trackingMore: {
          configured: !!trackingMoreApiKey,
          hasToken: !!trackingMoreApiKey,
          tokenLength: trackingMoreApiKey ? trackingMoreApiKey.length : 0,
          baseUrl: 'https://api.trackingmore.com/v4'
        },
        ups: {
          configured: upsConfigured,
          hasAccessKey: !!upsAccessKey,
          hasUserId: !!upsUserId,
          hasPassword: !!upsPassword,
          baseUrl: 'https://onlinetools.ups.com/api/track'
        },
        track17: {
          configured: !!track17ApiKey,
          hasToken: !!track17ApiKey,
          tokenLength: track17ApiKey ? track17ApiKey.length : 0,
          baseUrl: 'https://api.17track.net/track/v2.2'
        },
        message: (parcelsApiKey || trackingMoreApiKey || upsConfigured || track17ApiKey) ? 'Proxy is configured correctly' : 'No API keys configured',
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production',
        apiDocumentation: {
          parcelsapp: 'https://parcelsapp.com/api-docs/',
          trackingmore: 'https://www.trackingmore.com/tracking-api',
          ups: 'https://developer.ups.com',
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
      
      // Test UPS OAuth
      if (upsConfigured) {
        try {
          const basicAuth = Buffer.from(`${upsUserId}:${upsPassword}`).toString('base64')
          const oauthUrl = 'https://wwwcie.ups.com/security/v1/oauth/token'
          const oauthResponse = await fetch(oauthUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${basicAuth}`,
              'x-merchant-id': upsAccessKey
            },
            body: new URLSearchParams({ grant_type: 'client_credentials' }),
            signal: AbortSignal.timeout(10000)
          })
          testResult.ups.apiReachable = oauthResponse.ok
          testResult.ups.apiStatus = oauthResponse.status
          if (oauthResponse.ok) {
            const oauthData = await oauthResponse.json()
            testResult.ups.hasToken = !!oauthData.access_token
          } else {
            const errorText = await oauthResponse.text()
            testResult.ups.apiError = errorText
          }
        } catch (e) {
          testResult.ups.apiReachable = false
          testResult.ups.apiError = e.message
        }
      }
      
      return res.status(200).json(testResult)
    }
    
    if (!parcelsApiKey && !trackingMoreApiKey && !upsConfigured && !track17ApiKey) {
      console.error('No API keys configured')
      return res.status(500).json({ 
        error: 'No API keys configured',
        message: 'Please set at least one: PARCELS_API_TOKEN, TRACKINGMORE_API_KEY, UPS_ACCESS_KEY+UPS_USER_ID+UPS_PASSWORD, or TRACK17_API_KEY in Vercel environment variables',
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

    // Determina quale provider usare
    const useTrackingMore = provider === 'trackingmore' || (provider === 'auto' && trackingMoreApiKey)
    const useUPS = provider === 'ups' || (provider === 'auto' && upsConfigured)
    const use17Track = provider === '17track' || (provider === 'auto' && track17ApiKey && !trackingMoreApiKey && !upsConfigured)
    
    // Prova prima ParcelsApp (se configurato e provider non è solo trackingmore, ups o 17track)
    if (parcelsApiKey && provider !== 'trackingmore' && provider !== 'ups' && provider !== '17track') {
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
            console.log(`[Tracking Proxy] ParcelsApp limit reached, trying fallback...`)
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
            
            // Se abbiamo fallback disponibili, provali
            if (useTrackingMore && trackingMoreApiKey) {
              console.log(`[Tracking Proxy] ParcelsApp error, trying TrackingMore fallback...`)
              throw new Error('PARCELSAPP_ERROR')
            } else if (useUPS && upsConfigured) {
              console.log(`[Tracking Proxy] ParcelsApp error, trying UPS fallback...`)
              throw new Error('PARCELSAPP_ERROR')
            } else if (use17Track && track17ApiKey) {
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
            // Se abbiamo fallback disponibili, provali
            if (useTrackingMore && trackingMoreApiKey) {
              console.log(`[Tracking Proxy] No UUID from ParcelsApp, trying TrackingMore fallback...`)
              throw new Error('NO_UUID')
            } else if (useUPS && upsConfigured) {
              console.log(`[Tracking Proxy] No UUID from ParcelsApp, trying UPS fallback...`)
              throw new Error('NO_UUID')
            } else if (use17Track && track17ApiKey) {
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
        // Se è SUBSCRIPTION_LIMIT_REACHED o altro errore, prova fallback
        if (parcelsError.message === 'SUBSCRIPTION_LIMIT_REACHED' || 
            parcelsError.message === 'PARCELSAPP_ERROR' || 
            parcelsError.message === 'NO_UUID') {
          console.log(`[Tracking Proxy] ParcelsApp failed, trying fallback providers...`)
          // Continua con i fallback
        } else {
          // Se non è un errore che vogliamo gestire con fallback, rilancia
          throw parcelsError
        }
      }
    }

    // Fallback a TrackingMore se configurato (priorità più alta di 17Track)
    if (useTrackingMore && trackingMoreApiKey) {
      try {
        console.log(`[Tracking Proxy] Using TrackingMore API...`)
        const trackingMoreData = await trackWithTrackingMore(tracking, trackingMoreApiKey)
        return res.status(200).json(trackingMoreData)
      } catch (trackingMoreError) {
        console.error(`[Tracking Proxy] TrackingMore error:`, trackingMoreError)
          // Se TrackingMore fallisce, prova UPS o 17Track come fallback
        if (useUPS && upsConfigured) {
          console.log(`[Tracking Proxy] TrackingMore failed, trying UPS fallback...`)
        } else if (use17Track && track17ApiKey) {
          console.log(`[Tracking Proxy] TrackingMore failed, trying 17Track fallback...`)
        } else {
          return res.status(500).json({
            error: 'TrackingMore API error',
            message: trackingMoreError.message,
            hint: 'Verifica che TRACKINGMORE_API_KEY sia configurato correttamente su Vercel. Ottieni una chiave gratuita su https://www.trackingmore.com/tracking-api'
          })
        }
      }
    }

    // Fallback a UPS se configurato
    if (useUPS && upsConfigured) {
      try {
        console.log(`[Tracking Proxy] Using UPS API...`)
        const upsData = await trackWithUPS(tracking, upsAccessKey, upsUserId, upsPassword)
        return res.status(200).json(upsData)
      } catch (upsError) {
        console.error(`[Tracking Proxy] UPS error:`, upsError)
        // Se UPS fallisce, prova 17Track come ultimo fallback
        if (use17Track && track17ApiKey) {
          console.log(`[Tracking Proxy] UPS failed, trying 17Track fallback...`)
        } else {
          return res.status(500).json({
            error: 'UPS API error',
            message: upsError.message,
            hint: 'Verifica che UPS_ACCESS_KEY, UPS_USER_ID e UPS_PASSWORD siano configurati correttamente su Vercel. Registrati su https://developer.ups.com'
          })
        }
      }
    }

    // Fallback a 17Track se configurato (ultimo fallback)
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
      hint: 'Configura almeno una di queste: PARCELS_API_TOKEN, TRACKINGMORE_API_KEY, UPS_ACCESS_KEY+UPS_USER_ID+UPS_PASSWORD, o TRACK17_API_KEY su Vercel'
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
