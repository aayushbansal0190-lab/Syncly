import axios, { type AxiosError } from "axios";
import toast from "react-hot-toast";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export const axiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

// Response interceptor: runs for EVERY response from the backend, in one place.
// The backend rate-limits requests and replies with HTTP 429 ("Too Many
// Requests") when you go over the limit. Here we catch that one status and show
// a clear toast, so the user understands they need to slow down instead of
// seeing a vague error. We still re-throw the error so each caller's own
// .catch / try-catch keeps working exactly as before.
axiosInstance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 429) {
      // Express sends a "Retry-After" header (in seconds) telling us how long
      // to wait. We surface it when present for a more helpful message.
      const retryAfter = error.response.headers?.["retry-after"];
      const waitHint = retryAfter ? ` Try again in ${retryAfter}s.` : "";
      toast.error(`Too many requests — please slow down.${waitHint}`);
    }
    return Promise.reject(error);
  }
);
