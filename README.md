# Anime Expedition Calculator - Struttura Completa

## Organizzazione Cartelle

L'applicazione è strutturata con le seguenti cartelle principali:

```
/Anime Expedition Calculator/
  ├── index.html          
  ├── Units/              
  │   ├── <unit_name>\ Data     
  │   │   ├── <unit_name>_data.json         --- Including summons, passives, DoT etc...
  │   │   └── <unit_name>_image.jpg
  │   └── [all the units' folders]
  ├── Equipments/
  │   ├── <equipment_name>\ Data     
  │   │   ├── <equipment_name>_data.json         --- Including their passives, unit bounds etc...
  │   │   └── <equipment_name>_image.jpg
  │   └── [all the equipments' folders]
  ├── Logos/           
  │   ├── hydro.png
  │   ├── pyro.png
  │   └── [tutti gli elementi .png]
  └── Traits/ 
      ├── <trait_name>\ Data     
      │   ├── <trait_name>_data.json         
      │   └── <trait_name>_image.jpg
      └── [all the traits' folders]
```

## Come Funziona l'Applicazione

L'HTML `index.html` è un file statico che può essere aperto su qualsiasi browser web (Chrome, Firefox, Safari, Edge). Non richiede server web, database o connessione internet per funzionare dopo il caricamento iniziale dei dati.

### Struttura Dati Units

Ogni unità nel file JavaScript ha questo formato:
```javascript
{
  name: "Nome Unità",
  rarity: "Secret",        // Secret/Exclusive/Mythic/Legendary/Epic/Rare
  deployCost: 2000,        // Costo in yen per schierare
  totalCost: 72750,        // Costo totale per max upgrade
  tdps: 75789,            // TDPS calcolato (DPS totale su 3 nemici con Unbound)
  trait1: "Unbound",      // Tratto #1 (sempre Unbound per max danno)
  trait2: "Primordial",   // Tratto #2 (varia per tipo unità)
  obtainable: true,       // true = ottenibile, false = Limited/Non Ottenibile
  element: "Hydro/Magical", // Elemento dell'unità
  typeLogo: "warrior",    // Logo tipo unità dal gioco
  icon: "units/wolf-revived.png"  // Percorso immagine
}
```

### Le 4 Container per Riga (Design)

Ogni unità è visualizzata come una card con **4 container interni**:
1. **Icona Unità** (in alto) - logo/immagine dell'unità
2. **Nome Unità** (al centro) - testo leggibile
3. **Rarità** (in alto a destra) - badge colorato per rarità
4. **Tratti** (sotto il nome) - tratti #1 e #2 visualizzati come badge

Ogni card contiene anche:
- Costo Deploy (¥)
- Stato Ottenibilità (Ottenibile/Non Ottenibile)

### Colori per Rarità

- **Secret**: #ffd700 (oro)
- **Exclusive**: #b4e6ff (azzurro chiaro)
- **Mythic**: #ff0080 (rosa shocking)
- **Legendary**: #a335ee (viola)
- **Epic**: #3b3ce3 (blu elettrico)
- **Rare**: #8b572c (marrone)

### Stato Ottenibilità

- **Ottenibile** (verde): Unità non Limited, disponibili in qualsiasi momento
- **Non Ottenibile** (rosso): Unità Limited, eventi temporanei, banner specifici

### Per Far Funzionare il Sito al 100%

1. **Aggiungere le immagini**: Scaricare tutte le immagini unità da wiki.animeexpeditions.com/Units e metterle nella cartella `units/`
   - Nome file: `unità-cognome.png` (es. `wolf-revived.png`)
   - Formato: PNG, dimensione consigliata 64x64px o maggiore

2. **Aggiungere dati completi**: Popolare la variabile `unitsData` nel file JavaScript con tutti i dati TDPS, costi, tratti per tutte le 680 unità

3. **Aggiungere elementi e tratti**: Popolare le cartelle `elements/` e `cresttypes/` con i loghi corrispondenti

4. **Equipaggiamenti**: Aggiungere icone nella cartella `equipments/` e collegarle nelle card unità

### Per Far Girare l'Applicazione 24/7

Essendo un file HTML locale:
- Basta avere il computer acceso
- Aprire il file `/Users/nxco/Desktop/Anime Expedition Calculator/index.html` su qualsiasi browser
- Il sito rimarrà aperto e funzionante finché il browser rimane aperto
- Non richiede connessione internet dopo il caricamento iniziale (se i dati e le immagini sono locali)
- Puoi usare la funzione "Aggiungi a Home screen" su mobile o "Create shortcut" su desktop per un accesso rapido

### Struttura Dati da Popolare

Il file `index.html` contiene già la struttura HTML e CSS. La variabile `unitsData` nel tag `<script>` deve essere popolata con tutti i dati. Ecco l'elenco delle unità che devono essere incluse (in ordine di rarità e importanza):

**Secret (23 unità)**: Wolf, Atom, Reaper, Emerald Fist, First Blade, Princess, Silver Falcon, Black Heart, Dead Melody, 5th God Hand, Iron Wolf, Devil, Crimson Captain, Lightning God, Sovereign, Cubert, Crow, Impaler, e altre...

**Exclusive (6 unità)**: Atom Totality, Crimson Brother, Cubert, ecc.

**Mythic (24 unità)**: Dead Melody, First Blade, Princess, Black Heart, Alchemy Brothers, Rainman, Ignition Commander, Traitor, Noble Captain, Bioinsect, Cursed Student, Elf Mage, Flame Emperor, Hollow, e altre...

**Legendary (8 unità)**: Forbidden Teacher, Greed, Ice Queen, Ramen Guy, Scissor, Reaper, The Hero, Water Princess

**Epic (4 unità)**: Bounty Hunter, Corps Captain, Demon Cyborg, Ice Mage

**Rare (6 unità)**: Curly Brow, Kid Assassin, Reishi Archer, Rubber Boy, Little Carrot, Thunder Shinobi

### Note Importanti

- Il file tier list statico `TIER_LIST_ANIME_EXPEDITIONS.md` sul desktop contiene tutti i dati TDPS precisi, costi, passivi ed equipaggiamenti che possono essere utilizzati come riferimento per popolare il database
- Il calculator è stato progettato per essere elegante e funzionale, stile vicino a quello del gioco ma non 1:1 copia
- Tutte le immagini andranno estratte dal wiki o dal client gioco e messe nelle cartelle appropriate
- Il sito può essere "incollato" sulla home screen del computer o del telefono per un accesso rapido tipo app

### Passaggi Successivi

1. Estrarre tutte le immagini unità dal wiki e metterle in `units/`
2. Popolare `unitsData` con tutti i dati delle 680 unità
3. Aggiungere loghi elementi in `elements/`
4. Aggiungere loghi tratti in `cresttypes/`
5. Aggiungere icone equipaggiamenti in `equipments/`
6. Testare il sito su browser desktop e mobile
7. Aggiungere funzionalità extra: filtri per rarità, tratti, tipo AOe, calcolatore TDPS personalizzato
