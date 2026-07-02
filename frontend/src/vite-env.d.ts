/// <reference types="vite/client" />

// Typed access to the VITE_* env vars we read at runtime.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
