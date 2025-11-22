import React, { useState } from 'react'

export default function App() {
  const [trackingCode, setTrackingCode] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [errorDetails, setErrorDetails] = useState(null)
  const [orderInfo, setOrderInfo] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [useDirectAPI, setUseDirectAPI] = useState(false)
  const [apiToken, setApiToken] = useState('')

  async function fetchTracking() {
    if (!trackingCode.trim()) {
      setError('Inserisci un tracking code')
      return
    }

    setLoading(true)
    setError(null)
    setErrorDetails(null)
    setEvents([])
    setOrderInfo(null)

    try {
      let res
      let apiUrl
      let proxyUrl = typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? `http://localhost:3000/parcels?tracking=${encodeURIComponent(trackingCode)}`
        : `/api/parcels-proxy?tracking=${encodeURIComponent(trackingCode)}`
      
      // Opzione per bypassare il proxy e chiamare direttamente l'API (solo per test)
      if (useDirectAPI && apiToken) {
        const base = 'https://api.parcelsapp.com'
        apiUrl = `${base}/v1/trackings/${encodeURIComponent(trackingCode)}`
        console.log('Using direct API call:', apiUrl)
        
        try {
          res = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Accept': 'application/json'
            }
          })
        } catch (fetchError) {
          const networkError = {
            message: 'Errore di connessione diretta all\'API',
            type: 'NetworkError',
            details: fetchError.message || 'Impossibile connettersi all\'API Parcels',
            url: apiUrl,
            originalError: fetchError.message
          }
          setError('Errore di connessione all\'API Parcels')
          setErrorDetails(networkError)
          throw new Error('Errore di connessione')
        }
      } else {
        // Usa il proxy normale
        try {
          res = await fetch(proxyUrl)
        } catch (fetchError) {
          // Errore di rete (fetch fallito)
          const networkError = {
            message: 'Errore di connessione',
            type: 'NetworkError',
            details: fetchError.message || 'Impossibile connettersi al server',
            url: proxyUrl,
            originalError: fetchError.message
          }
          setError('Errore di connessione al server')
          setErrorDetails(networkError)
          throw new Error('Errore di connessione')
        }
      }
      
      if (!res.ok) {
        let errorData = {}
        let responseText = ''
        
        try {
          responseText = await res.text()
          console.log('Response text:', responseText)
          
          if (responseText && responseText.trim()) {
            try {
              errorData = JSON.parse(responseText)
            } catch (parseErr) {
              // Se non è JSON valido, usa il testo come dettaglio
              errorData = { 
                error: `Errore HTTP ${res.status}`,
                rawResponse: responseText
              }
            }
          } else {
            // Risposta vuota
            errorData = { 
              error: `Errore HTTP ${res.status} - Risposta vuota dal server`,
              emptyResponse: true
            }
          }
        } catch (textErr) {
          // Errore nel leggere il testo della risposta
          console.error('Errore nel leggere risposta:', textErr)
          errorData = { 
            error: `Errore HTTP ${res.status}`,
            readError: textErr.message
          }
        }
        
        // Crea un oggetto errore dettagliato con tutte le informazioni disponibili
        const errorMessage = errorData.error || errorData.message || `Errore HTTP ${res.status}: ${res.statusText || 'Bad Gateway'}`
        const details = {
          status: res.status,
          statusText: res.statusText || 'Bad Gateway',
          message: errorMessage,
          type: 'HTTPError',
          details: errorData.details || errorData.hint || errorData.rawResponse || (errorData.emptyResponse ? 'Il server ha restituito una risposta vuota' : 'Nessun dettaglio disponibile'),
          url: proxyUrl,
          fullError: errorData,
          responseHeaders: Object.fromEntries(res.headers.entries())
        }
        
        // Aggiungi suggerimenti specifici per status code comuni
        if (res.status === 502) {
          details.suggestion = 'Il proxy non è riuscito a connettersi all\'API Parcels. Verifica che PARCELS_API_TOKEN sia configurato correttamente su Vercel.'
        } else if (res.status === 500) {
          details.suggestion = 'Errore interno del server. Controlla i log di Vercel per maggiori dettagli.'
        } else if (res.status === 404) {
          details.suggestion = 'Endpoint non trovato. Verifica che il percorso dell\'API sia corretto.'
        }
        
        setError(errorMessage)
        setErrorDetails(details)
        throw new Error(errorMessage)
      }

      let data
      try {
        data = await res.json()
      } catch (parseError) {
        // Errore nel parsing JSON
        const parseErrorDetails = {
          message: 'Errore nel parsing della risposta',
          type: 'ParseError',
          details: parseError.message || 'La risposta non è un JSON valido',
          url: proxyUrl,
          status: res.status
        }
        setError('Errore nel parsing della risposta del server')
        setErrorDetails(parseErrorDetails)
        throw new Error('Errore nel parsing della risposta')
      }

      // Normalizza la risposta ParcelsApp API
      // Struttura ParcelsApp: { shipments: [{ trackingId, events, carrier, ... }], done: boolean }
      let normalizedEvents = []
      let shipmentData = null
      
      // Gestisci la struttura ParcelsApp API
      if (data.shipments && Array.isArray(data.shipments) && data.shipments.length > 0) {
        shipmentData = data.shipments[0] // Prendi il primo shipment
        const shipment = shipmentData
        
        // Estrai eventi dal shipment
        if (shipment.events && Array.isArray(shipment.events)) {
          normalizedEvents = shipment.events
        } else if (shipment.tracking && shipment.tracking.events && Array.isArray(shipment.tracking.events)) {
          normalizedEvents = shipment.tracking.events
        }
        
        // Se non ci sono eventi ma c'è uno stato, crea un evento
        if (normalizedEvents.length === 0 && shipment.status) {
          normalizedEvents = [{
            status: shipment.status,
            description: shipment.statusDescription || shipment.status,
            timestamp: shipment.lastUpdate || new Date().toISOString()
          }]
        }
      } else if (Array.isArray(data)) {
        normalizedEvents = data
      } else if (data.events && Array.isArray(data.events)) {
        normalizedEvents = data.events
      } else if (data.tracking_events && Array.isArray(data.tracking_events)) {
        normalizedEvents = data.tracking_events
      } else if (data.history && Array.isArray(data.history)) {
        normalizedEvents = data.history
      } else if (data.tracking && Array.isArray(data.tracking)) {
        normalizedEvents = data.tracking
      } else if (data.statuses && Array.isArray(data.statuses)) {
        normalizedEvents = data.statuses
      }

      // Ordina gli eventi per data (più recenti prima)
      normalizedEvents = normalizedEvents
        .map(ev => ({
          id: ev.id || ev.timestamp || ev.date || ev.time || Math.random(),
          status: ev.status || ev.state || ev.description || ev.message || ev.title || 'Sconosciuto',
          note: ev.note || ev.description || ev.message || ev.details || ev.location || '',
          occurred_at: ev.occurred_at || ev.timestamp || ev.date || ev.time || ev.created_at || ev.datetime || new Date().toISOString(),
          location: ev.location || ev.place || ev.city || ''
        }))
        .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)) // Più recenti prima

      setEvents(normalizedEvents)

      // Salva informazioni aggiuntive sull'ordine
      if (shipmentData) {
        // Usa i dati dal shipment ParcelsApp
        setOrderInfo({
          tracking_code: shipmentData.trackingId || trackingCode,
          carrier: shipmentData.carrier?.name || shipmentData.carrier || '',
          status: shipmentData.status || shipmentData.state || '',
          estimated_delivery: shipmentData.estimatedDelivery || shipmentData.eta || '',
          origin: shipmentData.origin || '',
          destination: shipmentData.destination || ''
        })
      } else if (data.tracking_code || data.code || data.carrier || data.status) {
        // Fallback per altri formati
        setOrderInfo({
          tracking_code: data.tracking_code || data.code || trackingCode,
          carrier: data.carrier || data.courier || '',
          status: data.status || data.current_status || '',
          estimated_delivery: data.estimated_delivery || data.eta || ''
        })
      }
      
      // Mostra messaggio se il tracking non è ancora completo
      if (data._meta && !data._meta.done) {
        setError('Tracking in corso... I risultati potrebbero non essere completi. Riprova tra qualche secondo.')
      }

      if (normalizedEvents.length === 0) {
        setError('Nessun evento di tracking trovato per questo codice')
      }
    } catch (e) {
      console.error('Errore nel fetch tracking:', e)
      
      // Se non abbiamo già impostato errorDetails nel blocco try, crealo ora
      // Questo è un fallback per errori non gestiti
      if (!errorDetails) {
        const fallbackDetails = {
          message: e.message || String(e),
          type: e.name || 'Error',
          details: 'Errore sconosciuto durante la richiesta',
          url: typeof window !== 'undefined' && window.location.hostname === 'localhost'
            ? `http://localhost:3000/parcels?tracking=${encodeURIComponent(trackingCode)}`
            : `/api/parcels-proxy?tracking=${encodeURIComponent(trackingCode)}`
        }
        setError(e.message || String(e))
        setErrorDetails(fallbackDetails)
      }
      
      setEvents([])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !loading && trackingCode.trim()) {
      fetchTracking()
    }
  }

  async function testProxyConfig() {
    setLoading(true)
    setError(null)
    setErrorDetails(null)
    setTestResult(null)

    try {
      const testUrl = typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? 'http://localhost:3000/parcels?test=true'
        : '/api/parcels-proxy?test=true'

      const res = await fetch(testUrl)
      const data = await res.json()

      setTestResult(data)
      
      if (!data.configured) {
        setError('Proxy non configurato correttamente')
        setErrorDetails({
          message: data.message,
          type: 'ConfigurationError',
          details: 'Il token API non è configurato su Vercel'
        })
      }
    } catch (e) {
      setError('Errore nel test della configurazione')
      setErrorDetails({
        message: e.message,
        type: 'TestError',
        details: 'Impossibile connettersi al proxy'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <h1>Tracker Pacchi</h1>

      <section className="lookup">
        <h2>Cerca tracking</h2>
        <div className="row">
          <input 
            placeholder="Inserisci tracking code" 
            value={trackingCode} 
            onChange={e => setTrackingCode(e.target.value)}
            onKeyPress={handleKeyPress}
          />
          <button onClick={fetchTracking} disabled={loading || !trackingCode.trim()}>
            {loading ? 'Caricamento...' : 'Cerca'}
          </button>
          <button 
            onClick={testProxyConfig} 
            disabled={loading}
            style={{ background: '#059669' }}
            title="Testa la configurazione del proxy"
          >
            Test Config
          </button>
        </div>

        {testResult && (
          <div className={`test-result ${testResult.configured ? 'success' : 'error'}`}>
            <h3>Risultato Test Configurazione</h3>
            <div className="test-details">
              <p><strong>Configurato:</strong> {testResult.configured ? '✅ Sì' : '❌ No'}</p>
              <p><strong>Token Presente:</strong> {testResult.hasToken ? '✅ Sì' : '❌ No'}</p>
              {testResult.tokenLength && <p><strong>Lunghezza Token:</strong> {testResult.tokenLength} caratteri</p>}
              <p><strong>Base URL:</strong> <code>{testResult.baseUrl}</code></p>
              
              {testResult.baseUrlReachable !== undefined && (
                <p><strong>Base URL Raggiungibile:</strong> {testResult.baseUrlReachable ? '✅ Sì' : '❌ No'}
                  {testResult.baseUrlStatus && ` (Status: ${testResult.baseUrlStatus})`}
                  {testResult.baseUrlError && ` - Errore: ${testResult.baseUrlError}`}
                </p>
              )}
              
              {testResult.apiReachable !== undefined && (
                <>
                  <p><strong>API Raggiungibile:</strong> {testResult.apiReachable ? '✅ Sì' : '❌ No'}</p>
                  {testResult.workingEndpoint && (
                    <p><strong>Endpoint Funzionante:</strong> <code>{testResult.workingEndpoint}</code></p>
                  )}
                  {testResult.apiStatus && (
                    <p><strong>Status API:</strong> {testResult.apiStatus} {testResult.apiStatusText}</p>
                  )}
                  {testResult.apiError && (
                    <div>
                      <p><strong>Errore API:</strong> {testResult.apiError}</p>
                      {testResult.apiErrorCode && <p><strong>Codice Errore:</strong> {testResult.apiErrorCode}</p>}
                      {testResult.apiErrorName && <p><strong>Tipo Errore:</strong> {testResult.apiErrorName}</p>}
                    </div>
                  )}
                </>
              )}
              
              {testResult.testedEndpoints && testResult.testedEndpoints.length > 0 && (
                <div>
                  <p><strong>Endpoint Testati:</strong></p>
                  <ul className="test-endpoints-list">
                    {testResult.testedEndpoints.map((ep, idx) => (
                      <li key={idx}>
                        <code>{ep.url}</code>
                        {ep.status && <span> - Status: {ep.status} {ep.statusText}</span>}
                        {ep.error && <span> - ❌ Errore: {ep.error} {ep.code && `(${ep.code})`}</span>}
                        {ep.success && <span> - ✅ Raggiungibile</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              <p><strong>Messaggio:</strong> {testResult.message}</p>
            </div>
          </div>
        )}

        {loading && <p>Caricamento…</p>}
        
        {error && (
          <div className="error-box">
            <div className="error-header">
              <strong>❌ Errore</strong>
            </div>
            <div className="error-message">{error}</div>
            {errorDetails ? (
              <div className="error-details">
                {errorDetails.status && (
                  <div className="error-detail-item">
                    <strong>Status Code:</strong> {errorDetails.status} {errorDetails.statusText && `(${errorDetails.statusText})`}
                  </div>
                )}
                {errorDetails.type && (
                  <div className="error-detail-item">
                    <strong>Tipo Errore:</strong> {errorDetails.type}
                  </div>
                )}
                {errorDetails.details && typeof errorDetails.details === 'string' && errorDetails.details.trim() && (
                  <div className="error-detail-item">
                    <strong>Dettagli:</strong> {errorDetails.details}
                  </div>
                )}
                {errorDetails.details && typeof errorDetails.details === 'object' && Object.keys(errorDetails.details).length > 0 && (
                  <div className="error-detail-item">
                    <strong>Dettagli:</strong>
                    <pre className="error-json">{JSON.stringify(errorDetails.details, null, 2)}</pre>
                  </div>
                )}
                {errorDetails.originalError && (
                  <div className="error-detail-item">
                    <strong>Errore Originale:</strong> {errorDetails.originalError}
                  </div>
                )}
                {errorDetails.url && (
                  <div className="error-detail-item">
                    <strong>URL richiesta:</strong> <code>{errorDetails.url}</code>
                  </div>
                )}
                {errorDetails.fullError && (
                  <div className="error-detail-item">
                    <strong>Risposta Completa:</strong>
                    <pre className="error-json">{JSON.stringify(errorDetails.fullError, null, 2)}</pre>
                  </div>
                )}
                {errorDetails.suggestion && (
                  <div className="error-hint">
                    <strong>💡 Suggerimento:</strong> {errorDetails.suggestion}
                    {errorDetails.status === 502 && (
                      <>
                        <br />
                        Vai su Vercel Dashboard → Settings → Environment Variables e verifica che <code>PARCELS_API_TOKEN</code> sia configurato.
                      </>
                    )}
                  </div>
                )}
                {!errorDetails.suggestion && errorDetails.status === 502 && (
                  <div className="error-hint">
                    <strong>💡 Suggerimento:</strong> Verifica che <code>PARCELS_API_TOKEN</code> sia configurato nelle variabili d'ambiente di Vercel.
                    <br />
                    Vai su Vercel Dashboard → Settings → Environment Variables
                  </div>
                )}
                {errorDetails.responseHeaders && Object.keys(errorDetails.responseHeaders).length > 0 && (
                  <div className="error-detail-item">
                    <strong>Header Risposta:</strong>
                    <pre className="error-json">{JSON.stringify(errorDetails.responseHeaders, null, 2)}</pre>
                  </div>
                )}
                {errorDetails.status === 500 && errorDetails.details && typeof errorDetails.details === 'string' && errorDetails.details.includes('PARCELS_API_TOKEN') && (
                  <div className="error-hint">
                    <strong>💡 Suggerimento:</strong> Il token API non è configurato. Aggiungi <code>PARCELS_API_TOKEN</code> nelle variabili d'ambiente di Vercel.
                  </div>
                )}
                {!errorDetails.status && !errorDetails.details && !errorDetails.originalError && (
                  <div className="error-detail-item">
                    <strong>Informazioni:</strong> Errore generico durante la richiesta. Controlla la console del browser per maggiori dettagli.
                  </div>
                )}
              </div>
            ) : (
              <div className="error-details">
                <div className="error-detail-item">
                  <strong>Informazioni:</strong> Nessun dettaglio disponibile. Controlla la console del browser per maggiori informazioni.
                </div>
              </div>
            )}
          </div>
        )}

        {orderInfo && !loading && (
          <div className="order-info">
            <h3>Informazioni Ordine</h3>
            <p><strong>Tracking Code:</strong> {orderInfo.tracking_code}</p>
            {orderInfo.carrier && <p><strong>Corriere:</strong> {orderInfo.carrier}</p>}
            {orderInfo.status && <p><strong>Stato Attuale:</strong> {orderInfo.status}</p>}
            {orderInfo.estimated_delivery && (
              <p><strong>Consegna Prevista:</strong> {new Date(orderInfo.estimated_delivery).toLocaleDateString('it-IT')}</p>
            )}
          </div>
        )}

        {!loading && events.length > 0 && (
          <>
            <h3>Storico Eventi ({events.length})</h3>
            <ol className="timeline">
              {events.map((ev, index) => (
                <li key={ev.id || index}>
                  <div className="event-status">{ev.status}</div>
                  {ev.note && <div className="event-note">{ev.note}</div>}
                  {ev.location && <div className="event-location">📍 {ev.location}</div>}
                  <div className="event-time">
                    {new Date(ev.occurred_at).toLocaleString('it-IT', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}

        {!loading && events.length === 0 && !error && trackingCode && (
          <p className="muted">Nessun evento da mostrare. Cerca un tracking code per vedere gli aggiornamenti.</p>
        )}
      </section>

      <footer>
        <small>Powered by Parcels API</small>
      </footer>
    </div>
  )
}
