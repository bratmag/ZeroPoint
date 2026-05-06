# Trimble Connect Georeferering

Prototype for en Trimble Connect-utvidelse som genererer world/offset-filer for modeller som er levert i lokalt koordinatsystem.

## MVP

Utvidelsen skal:

1. Liste opp modellfiler i prosjektet:
   - `.ifc`
   - `.trb`
   - `.dwg`
2. La brukeren velge en eller flere modeller.
3. La brukeren angi:
   - lokalt øst/nullpunkt
   - lokalt nord/nullpunkt
   - absolutt øst
   - absolutt nord
4. Generere en tilhørende world-fil med samme filnavn:
   - `modell.ifc` -> `modell.ifcw`
   - `modell.trb` -> `modell.trbw`
   - `modell.dwg` -> `modell.dwgw`
5. Laste world-filene opp til samme Trimble Connect-mappe som originalmodellene.

## Filformat

Basert på testfilen `SLMS_RIVA.ifcw`:

```txt
0.0, 0.0, 103650.000, 1263020.000
```

Tolkning:

```txt
lokal_ost, lokal_nord, absolutt_ost, absolutt_nord
```

Eksempel:

```txt
0.0, 0.0, 103650.000, 1263020.000
```

## Første tekniske fase

Fase 1 bygger en lokal prototype som kan:

- vise UI-flyten
- validere filnavn
- generere riktig world-filnavn
- generere riktig tekstinnhold

Fase 2 kobler dette mot Trimble Connect SDK/API for:

- prosjektkontekst
- fillisting
- mappeplassering
- opplasting

