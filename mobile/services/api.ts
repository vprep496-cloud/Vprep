import axios from "axios";
import Toast from "react-native-toast-message";
import { getItem, deleteItem } from "../lib/storage";
import { API_BASE_URL } from "../config/runtime";

// Key used to persist the Firebase ID token in the device keychain.
export const TOKEN_STORAGE_KEY = "vprep_auth_token";

// Phase 7 global polish: network error boundary. Axios tags a request that
// never reached the server (no connectivity, DNS failure, timeout before any
// response) with `code === "ERR_NETWORK"` and an undefined `error.response` —
// that combination is the one reliable signal that the *device* is offline
// rather than the *server* returning a 4xx/5xx. A module-level timestamp
// throttles the toast so a screen firing several queries at once while
// offline (e.g. the home dashboard's parallel `useQuery` calls) shows ONE
// "No internet connection" toast, not five stacked on top of each other.
let lastNetworkToastAt = 0;
const NETWORK_TOAST_THROTTLE_MS = 4000;

function notifyNetworkError(text1: string, text2: string) {
  const now = Date.now();
  if (now - lastNetworkToastAt < NETWORK_TOAST_THROTTLE_MS) return;
  lastNetworkToastAt = now;
  Toast.show({
    type: "error",
    text1,
    text2,
  });
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach the stored bearer token (if any) to every outgoing request.
api.interceptors.request.use(
  async (config) => {
    const token = await getItem(TOKEN_STORAGE_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ---------------------------------------------------------------------------
// Snake-case → camelCase transformer
//
// The FastAPI backend serialises all Pydantic models with snake_case field
// names (e.g. `display_name`, `firebase_uid`, `created_at`), but every
// TypeScript interface and every screen in this app uses camelCase
// (`displayName`, `firebaseUid`, `createdAt`).  Rather than patching every
// call-site we transform once here, centrally, so the mismatch never leaks
// past the service layer.
//
// Only plain-object keys are transformed; array items, primitives, null,
// and Date values pass through untouched.
// ---------------------------------------------------------------------------
function snakeToCamelStr(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function deepCamel(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(deepCamel);
  if (val !== null && typeof val === "object" && !(val instanceof Date)) {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [
        snakeToCamelStr(k),
        deepCamel(v),
      ])
    );
  }
  return val;
}

// Response pipeline:
//  1. Snake → camelCase transform on every successful response body.
//  2. Network failures (`ERR_NETWORK` — no `response` at all) surface a
//     de-duplicated "No internet connection" toast (Phase 7 global polish).
//  3. On 401 Unauthorized, the stored token is no longer valid — remove it so
//     the auth guard can route the user back to the login screen.
api.interceptors.response.use(
  (response) => {
    // Transform the data in-place so callers always receive camelCase.
    if (response.data !== null && typeof response.data === "object") {
      response.data = deepCamel(response.data);
    }
    return response;
  },
  async (error) => {
    if (error?.code === "ECONNABORTED") {
      notifyNetworkError(
        "Request timed out",
        "Check the laptop backend, Ollama, and Wi-Fi connection, then try again."
      );
    } else if (error?.code === "ERR_NETWORK" && !error?.response) {
      notifyNetworkError(
        "Backend unreachable",
        "Make sure your phone and laptop are on the same Wi-Fi and the API URL uses the laptop LAN IP."
      );
    } else if (error?.response?.status === 503 || error?.response?.status === 504) {
      const detail = error?.response?.data?.detail;
      notifyNetworkError(
        "Local AI unavailable",
        typeof detail === "string" ? detail : "Start Ollama and confirm llama3.2:3b is pulled."
      );
    } else if (error?.response?.status === 401) {
      await deleteItem(TOKEN_STORAGE_KEY);
    }
    return Promise.reject(error);
  }
);

export default api;
