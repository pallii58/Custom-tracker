# Tracker - MVP (Supabase + React)

Questo repository contiene un MVP frontend React che si connette a Supabase (Postgres + Auth) per mostrare lo storico di tracking per gli ordini.

Scopo: fornirti una soluzione economica e pronta per il deploy su Vercel/Netlify con backend gestito (Supabase free tier).

Prerequisiti
- Account su https://supabase.com
- Node.js (consigliato >=16) e npm

Setup rapido
1. Crea un nuovo progetto su Supabase.
2. Vai a SQL editor e incolla il contenuto di `sql/migration.sql` per creare le tabelle.
3. Nella dashboard di Supabase prendi i valori `URL` e `anon key` (Settings -> API).
4. Nella cartella del progetto crea un file `.env` con:

VITE_SUPABASE_URL="https://<your-project>.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"

5. Installa e avvia il progetto:

```bash
npm install
npm run dev
```

6. Apri http://localhost:5173 e usa l'interfaccia: puoi creare un ordine (admin rapido) e poi cercare il tracking code per vedere la timeline.

Deploy
- Per deploy gratuito, collega il repository a Vercel o Netlify e aggiungi le stesse variabili d'ambiente nella dashboard del servizio.
- Supabase offre piano gratuito per molti progetti MVP; se prevedi alto volume, considera il piano a pagamento.

Deploy su Vercel (guida passo-passo)
----------------------------------
Questa repo è pronta per essere deployata su Vercel. Segui questi passi per pubblicare:

1. Inizializza un repository Git nella cartella del progetto (se non l'hai già fatto) e fai push su GitHub/GitLab/Bitbucket:

```bash
git init
git add .
git commit -m "Initial tracker MVP"
git branch -M main
# crea un repo su GitHub e poi:
git remote add origin git@github.com:<tuo-account>/<tuo-repo>.git
git push -u origin main
```

2. Vai su https://vercel.com, effettua il login e clicca "New Project" -> "Import Git Repository" -> scegli il repo appena pushato.

3. Durante l'importazione, aggiungi le seguenti Environment Variables (required):

 - `VITE_SUPABASE_URL` => il tuo Supabase URL
 - `VITE_SUPABASE_ANON_KEY` => la anon/public key Supabase
 - `PARCELS_API_TOKEN` => il token Parcels che hai (server-side)
 - `PARCELS_API_BASE` => (opzionale) base URL dell'API Parcels, es. `https://api.parcelsapp.com`

4. Vercel rileverà il framework (Vite) e il comando di build `npm run build`. Conclude il deploy automaticamente.

5. Dopo il deploy, la tua web app sarà disponibile all'URL fornito da Vercel. Le chiamate al proxy Parcels saranno indirizzate a `/api/parcels-proxy?tracking=...` e useranno `PARCELS_API_TOKEN` impostato nelle env vars.

Note di sicurezza
- Non committare mai i token nelle variabili d'ambiente locali o file `.env` nel repo.
- Usa le env vars della dashboard di Vercel per mantenere i segreti fuori dal codice.

Se vuoi, posso creare il repository Git per te (se mi dai permessi) oppure guidarti passo passo mentre fai il deploy — dimmi come preferisci procedere.

Prossimi passi consigliati
- Aggiungere autenticazione per clienti (Supabase Auth) e restrizioni RLS per sicurezza.
- Implementare webhook o funzioni server-side per integrazione automatica con corrieri.
- Creare pagine admin più robuste e meccanismi per notifiche (email/SMS).

Se vuoi, proseguo e implemento anche il backend Node/Express o l'integrazione con corrieri. Altrimenti posso già preparare il deploy su Vercel per te.

Integrazione con servizi di terze parti (es. Parcels API)
-------------------------------------------------------
Se hai una API esterna (come Parcels) che richiede un token, non inserirla nel client: usa un proxy server-side per mantenere il token segreto.

Esempio rapido:
- Per il deploy su Vercel: aggiungi la variabile d'ambiente `PARCELS_API_TOKEN` nella dashboard del progetto e utilizza la API route `/api/parcels-proxy` inclusa in questo repo.
- Per test locale: crea la variabile d'ambiente `PARCELS_API_TOKEN` e (opzionale) `PARCELS_API_BASE`, poi avvia il proxy locale:

```bash
export PARCELS_API_TOKEN="<il-tuo-token>"
node server/proxy.js
# poi apri un'altra shell e avvia il client
npm run dev
```

Esempio di chiamata diretta (solo per test, non in client):

```bash
curl -H "Authorization: Bearer <IL_TUO_TOKEN>" "https://api.parcelsapp.com/v1/trackings/<TRACKING_CODE>"
```

Nota: il path `/v1/trackings/` è un placeholder. Sostituiscilo con il percorso corretto dell'API Parcels che stai usando.
