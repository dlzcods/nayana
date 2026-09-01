# NAYANA landing page

Responsive competition landing page built with React, TanStack Router, Tailwind CSS 4, and Motion.

## Local development

Install dependencies from the monorepo root, then run the web workspace:

```bash
npm install
npm run dev:web
```

Or, while working inside this directory:

```bash
npm run dev
```

## Validation

```bash
npm run check:css
npm run lint
npm run build
```

## Current routes

- `/` landing page
- `/model-evidence` documented evaluation boundary
- `/terms` draft terms of use

The product copy intentionally describes the classifier as a research prototype and preliminary screening aid, not a diagnosis or medical device.

## PDF report service

PDF reports use a dedicated lightweight Modal service so the download path does
not wait for the TensorFlow inference runtime. Add the deployed report URL to
the local web environment, then restart Vite:

    VITE_NAYANA_REPORT_API_BASE_URL="https://URL-REPORT-ANDA.modal.run"
