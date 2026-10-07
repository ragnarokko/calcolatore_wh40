Statistiche Wh40k

Come aggiornare i dati:

1 Modifica il file (o i file) nella cartella del repo e salva.

2 Dal terminale, nella cartella del repo, pubblica la modifica:

git add info.csv Datasheets_wargear.csv

git commit -m "Aggiorna dati"

git push

Attendi che GitHub Pages pubblichi il sito (di solito uno o due minuti). 
Puoi controllare aprendo ragnarokko.github.io/calcolatore_wh40/info.csv nel browser.


Set di dati

Ci sono due coppie di file: info_11e.csv + Datasheets_wargear_11e.csv (usati di default, generati dalla repo BSData/wh40k-11e) e info.csv + Datasheets_wargear.csv (originali, mai toccati dallo script). Per rigenerare i primi:

node tools/bsdata-to-csv.mjs --refresh

poi git add info_11e.csv Datasheets_wargear_11e.csv tools/bsdata-ids.json, commit e push. Le dimensioni delle basette mancanti si correggono a mano in info_11e.csv: vengono mantenute alle rigenerazioni successive. node tools/confronta-csv.mjs scrive in bsdata/confronto.md le differenze rispetto agli originali.

Per tornare ai file originali: in index.html imposta SET_PREDEFINITO = "originale" (o apri la pagina con ?dati=originale) e fai lo stesso nel Tavolo da Gioco (src/config/datiCsv.js).
