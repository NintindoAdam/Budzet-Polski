# Budżet Polski

Interaktywna wizualizacja budżetu państwa polskiego na lata 2011-2026. Pokazuje obywatelowi, na co państwo wydaje pieniądze, w sposób przystępny, wiarygodny i porównywalny między latami.

Strona na żywo: https://nintindoadam.github.io/Budzet-Polski/

Projekt Stowarzyszenia Terra Cracovianum (https://terracracovianum.org).

## Co to jest

Statyczna, jednostronicowa aplikacja webowa (HTML, CSS, vanilla JavaScript, D3.js v7). Bez build-stepu: wszystkie pliki dają się wgrać wprost na GitHub Pages, a biblioteki ładowane są z CDN. Dane pochodzą wprost z ustaw budżetowych (plan), a dla roku 2025 dodatkowo ze sprawozdania Ministerstwa Finansów (wykonanie).

## Funkcje

Sześć zakładek:

- Mapa wydatków: treemap z dwoma osiami, "na co (działy)" oraz "kto wydaje (części)", z wejściem w głąb do rozdziałów.
- Przepływ: diagram Sankey (dochody do budżetu do wydatków, deficyt na czerwono).
- Rodzaj wydatku: podział na 7 typów (świadczenia, dotacje, wydatki bieżące, majątkowe, obsługa długu, środki UE, współfinansowanie).
- Trendy: porównanie lat 2011-2026 (wykres wydatki/dochody/deficyt, struktura wg rodzaju, największe zmiany działów, przełącznik cen bieżących i stałych wg CPI).
- Twoje podatki: budżet na obywatela, podział z każdych 1000 zł, rozbicie własnej kwoty wg struktury wydatków.
- Plan vs wykonanie: porównanie planu z ustawy z wykonaniem (na razie tylko 2025).

Dodatkowo widok szczegółowy działu (beta, 2025): kliknięcie kafelka otwiera rozbicie "kto to wydaje" wraz z rozdziałami, linkowalne pod adresem URL.

## Dane i wiarygodność

- Kwoty budżetu to plan z ustaw (nie wykonanie), aby porównania między latami były metodologicznie spójne. Wykonanie pojawia się wyłącznie w dedykowanej, wyraźnie oznaczonej zakładce.
- Sumy dla każdego roku zgadzają się co do tysiąca złotych z kwotą "Ogółem" z ustawy.
- Inflacja (CPI) i liczba ludności: Główny Urząd Statystyczny. Wykonanie 2025: Ministerstwo Finansów. Źródła są cytowane w aplikacji.

## Uruchomienie lokalnie

Aplikacja używa fetch, więc wymaga prostego serwera HTTP (nie zadziała z file://):

```
python3 -m http.server 8000
```

Następnie otwórz http://localhost:8000

## Struktura plików

- `index.html`, `style.css`, `app.js`: struktura strony i cała logika.
- `budget-YYYY.json`: dane roczne (plan). Uwaga: rok 2026 to `budget-data.json`.
- `trends-data.json`: kompaktowa seria do zakładki Trendy (generowana przez `gen-trends.py`).
- `context-data.json`: CPI i liczba ludności (GUS).
- `wykonanie-2025.json`: wykonanie budżetu 2025 (MF).
- `logo.svg`: logo stowarzyszenia.

## Licencja i kontakt

Dane publiczne (Dziennik Ustaw, GUS, Ministerstwo Finansów). Projekt Stowarzyszenia Terra Cracovianum, https://terracracovianum.org.
