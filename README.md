# RCJ Rescue Maze – Configuratore & Arbitraggio

Web app per **progettare i campi gara**, **arbitrare le prove** e **generare i report PDF** della RoboCup Junior Rescue Maze.
I punteggi seguono il regolamento **RCJ Rescue Maze 2027** (draft del 2026-09-08, cap. 5.6).

Gira tutta nel browser: niente installazione, niente server, niente account. Si apre `index.html` e funziona anche offline.

---

## Funzionalità

### 1 · Labirinto (editor)
- Editor a griglia fino a **26×26 caselle**, con **più piani**.
- Strumenti: **muri** (clic o trascinamento sul bordo della casella), **seleziona**, **gomma**, **vittima**.
- Tipi di casella: normale, nera (buco), argento (checkpoint), blu (pozzanghera), rossa (ingresso zona pericolosa), partenza, rampa, scale, vuota (fuori campo).
- Elementi sulla casella: dossi, ostacoli, detriti, zona pericolosa.
- Vittime: **smiley** (ferita / stabile / illesa), **target cognitivi** e **false vittime**.
- **Calcolo automatico di vittime lineari e flottanti** (regola 3.3): sono lineari quelle sui muri collegati alla partenza, e le caselle nere contano come muri virtuali. Il calcolo si può forzare a mano su ogni singola vittima.
- **Generatore di labirinti classici** (recursive backtracker), con anelli regolabili e popolamento casuale di checkpoint, caselle blu e nere, dossi e vittime.
- **Controllo del regolamento**: partenza mancante o doppia, partenza in zona pericolosa, zona pericolosa senza casella rossa, vittime in posizioni non ammesse, caselle irraggiungibili.
- **Punteggio massimo teorico** del campo, calcolato in tempo reale.
- Esportazione del campo in **PNG** e dello **scoresheet vuoto** in PDF da stampare (A4 orizzontale).
- Grafica ispirata agli scoresheet del RCJ Rescue CMS: vittime `A, B, C…` lineari, `α, β, γ…` flottanti.

### 2 · Gara (arbitraggio)
- Ogni prova si crea indicando labirinto, evento, squadra, round, campo, arbitro e durata (8 minuti di default).
- Al momento della creazione la mappa viene **congelata**, così le modifiche successive al labirinto non toccano le prove già registrate.
- **Cronometro** con avvio e pausa, avviso a fine tempo (5.7.2a).
- Cliccando su una casella si registra cosa fa il robot: posizione, checkpoint, visite alle caselle blu, dossi, rampe, scale, identificazione delle vittime e kit consegnati.
- Lack of Progress con ritorno automatico all'ultimo checkpoint, misidentificazioni ed exit bonus.
- Punteggio live con il dettaglio di ogni voce (bonus affidabilità, bonus uscita, SVI, SRD, SBV…).
- Annullamento illimitato: la prova è salvata come sequenza di eventi e il punteggio viene ricalcolato rigiocandola.
- Note dell'arbitro, che finiscono nel PDF.

**Scorciatoie da tastiera**

| Tasto | Azione |
|---|---|
| Frecce | Sposta il robot |
| `L` | Lack of Progress |
| `M` | Misidentificazione (−5) |
| `Spazio` | Avvia / pausa cronometro |
| `Ctrl+Z` | Annulla |

### 3 · Storico & report
- Elenco di tutte le prove, filtrabile per squadra e per labirinto.
- **Classifica** con punteggi normalizzati sul migliore di ogni round e possibilità di scartare i round peggiori.
- Statistiche per squadra: miglior punteggio, media, vittime identificate, LoP, percentuale di uscite, tempo medio.
- **PDF della singola prova** (mappa con il percorso e scoresheet compilato) e **PDF recap di fine gara**.

### Dati
- Tutto viene salvato automaticamente nel `localStorage` del browser.
- Con **Esporta dati** / **Importa** si salvano o caricano da file JSON tutti i labirinti e tutte le prove, per fare backup o spostarli su un altro PC.

> ⚠️ I dati restano nel browser in cui sono stati creati. Se cancelli i dati di navigazione li perdi, quindi esporta regolarmente.

---

## Avvio

```bash
git clone https://github.com/c64guyy/rcj-maze-configurator.git
cd rcj-maze-configurator
```

Poi apri `index.html` nel browser (doppio clic). Va bene qualsiasi browser moderno: Chrome, Edge, Firefox, Safari.

In alternativa puoi servirlo in locale:

```bash
python3 -m http.server 8000
# poi vai su http://localhost:8000
```

Il progetto è statico, quindi si può pubblicare così com'è anche su **GitHub Pages** (Settings → Pages → branch `main`, cartella `/`).

---

## Struttura del progetto

```
.
├── index.html              # layout e tab
├── style.css               # stile
├── app.js                  # tutta la logica: modello, editor, arbitraggio, punteggi, PDF
└── lib/
    └── jspdf.umd.min.js    # jsPDF 2.5.1 (generazione PDF)
```

Non ci sono build step né dipendenze da installare: è JavaScript vanilla.

---

## Punteggio (riassunto)

| Voce | Punti |
|---|---|
| Vittima smiley identificata | 5 lineare · 15 flottante |
| Target cognitivo identificato | 10 lineare · 30 flottante |
| Kit di soccorso | 1 kit = 10 · 2 kit = 30 |
| Casella blu | 30 alla prima visita, −10 per ogni visita successiva |
| Checkpoint | 10 |
| Dossi | 5 per casella |
| Rampa / Scale | 10 |
| Bonus affidabilità | SVI·10 + SRD·10 + SBV·10 − LoP·15 |
| Bonus uscita | SVI·10 + SBV·10 + scale·5 + rampe·5 |
| Misidentificazione | −5 |

Il testo di riferimento resta il regolamento ufficiale RCJ: questa tabella serve solo come promemoria.

---

## Crediti

- [jsPDF](https://github.com/parallax/jsPDF) (licenza MIT) per la generazione dei PDF.
- Regolamento: [RoboCup Junior Rescue](https://junior.robocup.org/).

Progetto non ufficiale, non affiliato a RoboCup Federation.
