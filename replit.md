# Gid Lekòl

A Haitian Creole educational app for NS4 (Terminale) students in Haiti, built with React + Vite + Tailwind CSS.

## Project Overview

"Gid Lekòl" (School Guide) is a mobile-first web app featuring:
- AI-powered tutoring via Supabase Edge Functions ("ask-prof-lakay")
- Quiz system aligned to the MENFP NS4 curriculum (Biologie, Physique, Chimie, Philosophie, Sciences Sociales, Mathématiques, Littérature, Économie)
- Haitian Creole UI with error messages and interactions

## Architecture

- **Frontend**: React 18, Vite 5, Tailwind CSS
- **Backend**: Supabase Edge Functions (external)
- **Build target**: Web (PWA-capable) + Capacitor for Android APK

## Environment Variables

- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anonymous public key

## Development

```bash
npm run dev      # Start dev server on port 5000
npm run build    # Production build to dist/
npm run preview  # Preview production build
```

## Deployment

Configured as a **static** deployment:
- Build command: `npm run build`
- Public directory: `dist`

## Key Files

- `src/App.jsx` — Main app component (2300+ lines, self-contained)
- `src/main.jsx` — React entry point
- `src/index.css` — Global styles + Tailwind directives
- `vite.config.js` — Vite config (port 5000, allowedHosts: true)
- `index.html` — HTML shell with Inter font from Google Fonts
