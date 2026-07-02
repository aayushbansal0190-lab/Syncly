import { AxiosError } from "axios";

// In strict TypeScript a caught error is `unknown`, so we can't just reach for
// `error.response.data.message`. This narrows the common cases (Axios error ->
// our API's { message } body, then a generic Error) and falls back otherwise.
export const getErrorMessage = (error: unknown, fallback = "Something went wrong"): string => {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string } | undefined;
    return data?.message || error.message || fallback;
  }
  if (error instanceof Error) return error.message || fallback;
  return fallback;
};
