/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional build-time Google Maps Platform API key (Map Tiles API enabled). */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
