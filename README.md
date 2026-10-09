Statistiche Wh40k

Come aggiornare i dati:

1 Modifica il file (o i file) nella cartella del repo e salva, oppure rigenerali con uno degli script qui sotto.

2 Dal terminale, nella cartella del repo, pubblica la modifica:

git add info.csv Datasheets_wargear.csv

git commit -m "Aggiorna dati"

git push

Attendi che GitHub Pages pubblichi il sito (di solito uno o due minuti). 
Puoi controllare aprendo ragnarokko.github.io/calcolatore_wh40/info.csv nel browser.


Set di dati

Ci sono due coppie di file: info.csv + Datasheets_wargear.csv (tradizionali, da Wahapedia) e info_11e.csv + Datasheets_wargear_11e.csv (BSData, generati dalla repo BSData/wh40k-11e). Quale coppia usare si sceglie nel Tavolo da Gioco (rotella Impostazioni) e, qui, con ?dati=originale o ?dati=bsdata.


Dati tradizionali da Wahapedia (con punti e dati per l'army builder)

node tools/wahapedia-to-csv.mjs

Scarica l'export dati di Wahapedia (https://wahapedia.ru/wh40k11ed/<Tabella>.csv, specifica in "Export Data Specs"), mostra le differenze rispetto ai file attuali e poi riscrive:
- info.csv e Datasheets_wargear.csv (stesso formato di sempre più l'ultima colonna FNP, la soglia di Feel No Pain, presa da Datasheets_abilities.csv: abilità 000008338, valore della colonna parameter; con le stesse pulizie: basette senza "flying base"/"Use model", BS_WS senza "+", ecc.);
- la cartella army_builder/ con i dati extra: schede.csv (ruolo, fonte, Legends), punti.csv (costi per taglia e scaglione), composizione.csv (modelli minimi/massimi), opzioni.csv (opzioni di equipaggiamento, in testo), leader.csv, keywords.csv, abilita.csv + abilita_comuni.csv, distaccamenti.csv, potenziamenti.csv, regole_distaccamento.csv (regola di ogni distaccamento) e stratagemmi.csv (quelli dei distaccamenti più i 10 Core; ¶ separa i capoversi dei testi).

Opzioni: --sorgente <indirizzo> (altra edizione, es. https://wahapedia.ru/wh40k12ed; viene ricordato in tools/wahapedia-sorgente.json), --cache (riusa i file già scaricati in wahapedia/cache/, senza rete), --out <cartella> (scrive altrove invece che nel repo: utile per provare).

Le dimensioni delle basette corrette a mano stanno in tools/wahapedia-basette.json e hanno la precedenza su Wahapedia (lo script avvisa quando una correzione non coincide più con il sito). Non modificare a mano info.csv e Datasheets_wargear.csv se non vuoi perdere le modifiche al prossimo lancio.

Poi: git add info.csv Datasheets_wargear.csv army_builder tools/wahapedia-sorgente.json, commit e push. Per annullare un aggiornamento prima del commit: git checkout -- info.csv Datasheets_wargear.csv army_builder


Dati BSData

node tools/bsdata-to-csv.mjs --refresh

Se BSData sposta la repo: node tools/bsdata-to-csv.mjs --refresh --repo https://github.com/nuovo/indirizzo (l'indirizzo viene ricordato in tools/bsdata-sorgente.json: da committare insieme ai file; il Tavolo da Gioco, in Impostazioni, mostra il comando già pronto).

poi git add info_11e.csv Datasheets_wargear_11e.csv tools/bsdata-ids.json tools/bsdata-sorgente.json, commit e push. Le dimensioni delle basette mancanti si correggono a mano in info_11e.csv: vengono mantenute alle rigenerazioni successive. node tools/confronta-csv.mjs scrive in bsdata/confronto.md le differenze rispetto agli originali.

Anche info_11e.csv ha la colonna FNP: in BSData è il collegamento alla regola "Feel No Pain" della scheda (quelli con commento o nascosti, cioè concessi da capi/potenziamenti, sono ignorati).

I punti (army_builder/punti.csv) sono indicizzati per id Wahapedia: le unità BSData con lo stesso id o lo stesso nome li trovano (circa il 93%).

Per tornare ai file tradizionali: in index.html imposta SET_PREDEFINITO = "originale" (o apri la pagina con ?dati=originale) e fai lo stesso nel Tavolo da Gioco (src/config/datiCsv.js, oppure rotella Impostazioni).
