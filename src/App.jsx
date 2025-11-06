import React, { useState } from 'react'
import { supabase } from './supabaseClient'

export default function App() {
  const [trackingCode, setTrackingCode] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function fetchTimeline() {
    setLoading(true)
    setError(null)
    setEvents([])
    try {
      const { data, error: err } = await supabase
        .from('orders')
        .select('id, tracking_code, tracking_events(*)')
        .eq('tracking_code', trackingCode)
        .limit(1)
        .single()

      if (err) throw err
      if (!data) {
        setError('Order not found')
        setLoading(false)
        return
      }

      const ev = (data.tracking_events || []).slice().sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
      setEvents(ev)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  // --- Optional: fetch from external Parcels API via our proxy (keeps token server-side)
  async function fetchFromParcelsProxy() {
    if (!trackingCode) return alert('Inserisci un tracking code')
    setLoading(true)
    setError(null)
    try {
      // In production on Vercel this would be /api/parcels-proxy?tracking=...
      // For local testing run `node server/proxy.js` and use http://localhost:3000/parcels?tracking=...
      const proxyUrl = typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? `http://localhost:3000/parcels?tracking=${encodeURIComponent(trackingCode)}`
        : `/api/parcels-proxy?tracking=${encodeURIComponent(trackingCode)}`

      const res = await fetch(proxyUrl)
      if (!res.ok) throw new Error('Errore nel chiamare Parcels API: ' + res.status)
      const data = await res.json()

      // Normalizza la risposta in un array di eventi se possibile
      const ev = (data.events || data.tracking_events || data.history || []).slice().sort((a, b) => new Date(a.occurred_at || a.time) - new Date(b.occurred_at || b.time))
      setEvents(ev)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  // Simple admin helpers for quick local testing
  const [newOrderCode, setNewOrderCode] = useState('')
  const [newEventStatus, setNewEventStatus] = useState('')
  const [newEventNote, setNewEventNote] = useState('')

  async function createOrder() {
    if (!newOrderCode) return alert('Inserisci un tracking code')
    const { data, error: err } = await supabase
      .from('orders')
      .insert({ tracking_code: newOrderCode })
      .select()

    if (err) return alert('Errore: ' + err.message)
    alert('Ordine creato: ' + data[0].id)
    setNewOrderCode('')
  }

  async function addEvent() {
    if (!newEventStatus || !newEventNote) return alert('Completa i campi evento')
    // find order by tracking code (we assume newOrderCode was used)
    const { data: order } = await supabase.from('orders').select('id').eq('tracking_code', trackingCode).limit(1).single()
    if (!order) return alert('Ordine per addEvent non trovato (usa il campo tracking code principale)')

    const { error: err } = await supabase.from('tracking_events').insert({ order_id: order.id, status: newEventStatus, note: newEventNote })
    if (err) return alert('Errore: ' + err.message)
    alert('Evento aggiunto')
    setNewEventStatus('')
    setNewEventNote('')
    fetchTimeline()
  }

  return (
    <div className="container">
      <h1>Tracker - Demo</h1>

      <section className="lookup">
        <h2>Vedi tracking</h2>
        <div className="row">
          <input placeholder="Inserisci tracking code" value={trackingCode} onChange={e => setTrackingCode(e.target.value)} />
          <button onClick={fetchTimeline} disabled={loading || !trackingCode}>Cerca (Supabase)</button>
          <button onClick={fetchFromParcelsProxy} disabled={loading || !trackingCode} style={{ background: '#059669' }}>Cerca (Parcels API)</button>
        </div>
        {loading && <p>Caricamento…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && events.length === 0 && !error && <p>Nessun evento da mostrare.</p>}
        <ol className="timeline">
          {events.map(ev => (
            <li key={ev.id}>
              <div className="event-status">{ev.status}</div>
              <div className="event-note">{ev.note}</div>
              <div className="event-time">{new Date(ev.occurred_at).toLocaleString()}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="admin">
        <h2>Admin rapido (solo per test)</h2>
        <div className="row">
          <input placeholder="Nuovo tracking code" value={newOrderCode} onChange={e => setNewOrderCode(e.target.value)} />
          <button onClick={createOrder}>Crea ordine</button>
        </div>

        <div className="row">
          <input placeholder="Status evento" value={newEventStatus} onChange={e => setNewEventStatus(e.target.value)} />
          <input placeholder="Note evento" value={newEventNote} onChange={e => setNewEventNote(e.target.value)} />
          <button onClick={addEvent}>Aggiungi evento all'ordine cercato</button>
        </div>

        <p className="muted">Nota: per aggiungere un evento, prima cerca l'ordine inserendo il suo tracking code nel campo principale e clicca <em>Cerca</em>.</p>
      </section>

      <footer>
        <small>Stack consigliato: Supabase + Vercel. Vedi README per setup.</small>
      </footer>
    </div>
  )
}
