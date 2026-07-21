// Relative — Nginx reverse-proxies /api/* to the backend on the same origin
// in production (docs/SYSTEM_ARCHITECTURE.md Section 10.3), so no absolute
// host is needed or wanted here.
export const environment = {
  production: true,
  apiBaseUrl: '/api/v1',
  apiOrigin: '',
};
