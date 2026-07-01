/**
 * Runtime config for the SPA. The control-plane base URL is injected at build
 * time via Vite env (VITE_CONTROL_PLANE_URL); falls back to the local wrangler
 * dev port so `npm run dev` against a local Worker just works.
 */
export const CONTROL_PLANE_URL = import.meta.env.VITE_CONTROL_PLANE_URL || 'http://127.0.0.1:8788'
