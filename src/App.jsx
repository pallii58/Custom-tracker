import React, { useState } from 'react'

export default function App() {
  const [trackingCode, setTrackingCode] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [errorDetails, setErrorDetails] = useState(null)
  const [orderInfo, setOrderInfo] = useState(null)

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
      // In production on Vercel this would be /api/parcels-proxy?tracking=...
      // For local testing run `node server/proxy.js` and use http://localhost:3000/parcels?tracking=...
      const proxyUrl = typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? `http://localhost:3000/parcels?tracking=${encodeURIComponent(trackingCode)}`
        : `/api/parcels-proxy?tracking=${encodeURIComponent(trackingCode)}`

      const res = await fetch(proxyUrl)
      
      if (!res.ok) {
        let errorData
        try {
          errorData = await res.json()
        } catch (e) {
          errorData = { 
            error: `Errore HTTP ${res.status}`, 
            status: res.status,
            statusText: res.statusText 
          }
        }
        
        // Crea un oggetto errore dettagliato
        const errorMessage = errorData.error || errorData.message || `Errore ${res.status}`
        const details = {
          status: res.status,
          statusText: res.statusText,
          message: errorMessage,
          details: errorData.details || errorData.hint || errorData,
          url: proxyUrl
        }
        
        setError(errorMessage)
        setErrorDetails(details)
        throw new Error(errorMessage)
      }

      const data = await res.json()

      // Normalizza la risposta Parcels API in un formato comune
      // La struttura può variare, quindi proviamo diversi formati comuni
      let normalizedEvents = []
      
      if (Array.isArray(data)) {
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

      // Ordina gli eventi per data (più recenti prima o più vecchi prima, a seconda della struttura)
      normalizedEvents = normalizedEvents
        .map(ev => ({
          id: ev.id || ev.timestamp || ev.date || Math.random(),
          status: ev.status || ev.state || ev.description || ev.message || 'Sconosciuto',
          note: ev.note || ev.description || ev.message || ev.location || '',
          occurred_at: ev.occurred_at || ev.timestamp || ev.date || ev.time || ev.created_at || new Date().toISOString(),
          location: ev.location || ev.place || ''
        }))
        .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)) // Più recenti prima

      setEvents(normalizedEvents)

      // Salva informazioni aggiuntive sull'ordine se disponibili
      if (data.tracking_code || data.code || data.carrier || data.status) {
        setOrderInfo({
          tracking_code: data.tracking_code || data.code || trackingCode,
          carrier: data.carrier || data.courier || '',
          status: data.status || data.current_status || '',
          estimated_delivery: data.estimated_delivery || data.eta || ''
        })
      }

      if (normalizedEvents.length === 0) {
        setError('Nessun evento di tracking trovato per questo codice')
      }
    } catch (e) {
      console.error('Errore nel fetch tracking:', e)
      
      // Se non abbiamo già impostato errorDetails, crealo ora
      if (!errorDetails) {
        setError(e.message || String(e))
        setErrorDetails({
          message: e.message || String(e),
          type: e.name || 'Error',
          stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
        })
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
        </div>

        {loading && <p>Caricamento…</p>}
        
        {error && (
          <div className="error-box">
            <div className="error-header">
              <strong>❌ Errore</strong>
            </div>
            <div className="error-message">{error}</div>
            {errorDetails && (
              <div className="error-details">
                {errorDetails.status && (
                  <div className="error-detail-item">
                    <strong>Status Code:</strong> {errorDetails.status} {errorDetails.statusText && `(${errorDetails.statusText})`}
                  </div>
                )}
                {errorDetails.details && typeof errorDetails.details === 'string' && (
                  <div className="error-detail-item">
                    <strong>Dettagli:</strong> {errorDetails.details}
                  </div>
                )}
                {errorDetails.details && typeof errorDetails.details === 'object' && (
                  <div className="error-detail-item">
                    <strong>Dettagli:</strong>
                    <pre className="error-json">{JSON.stringify(errorDetails.details, null, 2)}</pre>
                  </div>
                )}
                {errorDetails.url && (
                  <div className="error-detail-item">
                    <strong>URL richiesta:</strong> <code>{errorDetails.url}</code>
                  </div>
                )}
                {errorDetails.status === 502 && (
                  <div className="error-hint">
                    <strong>💡 Suggerimento:</strong> Verifica che <code>PARCELS_API_TOKEN</code> sia configurato nelle variabili d'ambiente di Vercel.
                    <br />
                    Vai su Vercel Dashboard → Settings → Environment Variables
                  </div>
                )}
                {errorDetails.status === 500 && errorDetails.details && typeof errorDetails.details === 'string' && errorDetails.details.includes('PARCELS_API_TOKEN') && (
                  <div className="error-hint">
                    <strong>💡 Suggerimento:</strong> Il token API non è configurato. Aggiungi <code>PARCELS_API_TOKEN</code> nelle variabili d'ambiente di Vercel.
                  </div>
                )}
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
