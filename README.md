# EV Efficiency Tracker

A phone-friendly web app for logging Tesla trips. For each trip it shows efficiency, cost per mile, charging losses, and how much a gas car would have cost for the same drive. It can also scan a screenshot of the Tesla Energy app or Trips card and fill in the form for you.

Everything runs in your browser. There's no account and no server, and screenshots never leave your device.

## Features

- **Log a trip**: date, name, miles, starting and ending battery %, energy used (kWh), and notes. Results update as you type.
- **Scan a screenshot**: on-device OCR ([Tesseract.js](https://tesseract.projectnaptha.com/)) reads distance, kWh, Wh/mi and battery %. Scanned fields are outlined in green so you can check them before saving.
- **Metrics per trip**
  - Wh/mi, mi/kWh, miles per 1% of battery, MPGe
  - Energy used from the battery, and energy drawn from the wall (after charging losses)
  - Extra energy lost to charging, and what that loss cost
  - Trip cost and cost per mile at your home electricity rate
  - Gas car cost for the same trip, and how much you saved
- **Summary**: totals and mileage-weighted averages across all trips, plus your most and least efficient trips.
- **Data**: export to CSV, back up to JSON and restore, edit and delete trips.
- **Installable**: add it to your home screen and it opens offline. The OCR engine needs internet the first time you scan, then it's cached.

## How the numbers are calculated

| Metric | Formula |
| --- | --- |
| Battery energy | entered kWh, or else (start % − end %) × usable battery capacity |
| Wh/mi | battery kWh × 1000 ÷ miles |
| mi/kWh | miles ÷ battery kWh |
| Wall energy | battery kWh ÷ charging efficiency |
| Charging loss | wall kWh − battery kWh (cost = loss × $/kWh) |
| EV cost | wall kWh × $/kWh |
| Gas cost | miles ÷ MPG × $/gal |
| MPGe | miles ÷ (wall kWh ÷ 33.7) |

Each trip saves a copy of the rates that were set when you logged it (electricity price, charging efficiency, MPG, gas price, battery size). Changing a rate later won't rewrite past trips. To recalculate every trip, use **Settings → Apply these rates to all existing trips**.

## Scanning tips

- Screenshots work better than photos of the car screen. If you use a photo, fill the frame and avoid glare.
- Cropping to the trip card helps.
- If a value is misread, open **Text read from the image** to see what the OCR saw.
- The app checks the scan against itself: miles × Wh/mi should equal kWh. If they don't match, it warns you (usually a missed decimal point).

## Run it

It's a static site with no build step:

```sh
npm start        # serves at http://localhost:8080
npm test         # unit tests for the math and the screenshot parser
```

To use it on your phone, host the folder anywhere that serves over HTTPS. For example, turn on GitHub Pages for this repository (Settings → Pages → deploy from branch `main`, root folder). Then open the URL on your phone and choose **Add to Home Screen**.

## Project layout

```
index.html            app shell (Log, Trips, Summary, Settings tabs)
css/styles.css        mobile-first styles, light and dark mode
js/calc.js            trip math (pure, tested)
js/parse.js           OCR text → trip fields (pure, tested)
js/ocr.js             image preprocessing + Tesseract.js, loaded on first scan
js/storage.js         localStorage, CSV/JSON export
js/app.js             UI
sw.js                 offline cache
tests/                node:test unit tests
```
