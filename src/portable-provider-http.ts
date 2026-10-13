import { parseJsonStrict } from "./strict-json.js";

export type ProviderErrorCode = "provider_configuration_invalid" | "provider_input_invalid" |
  "provider_credentials_unavailable" | "provider_timeout" | "provider_unavailable" |
  "provider_response_invalid" | "provider_signature_invalid" | "provider_approval_invalid";

/** Intentionally contains no endpoint, credential, response body, or underlying cause. */
export class ProductionProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) {
    super(code);
    this.name = "ProductionProviderError";
  }
}

export const MAX_PROVIDER_BYTES = 1024 * 1024;
export function requireProvider(condition: unknown, code: ProviderErrorCode): asserts condition {
  if (!condition) throw new ProductionProviderError(code);
}

export function httpsEndpoint(value: string, originOnly = false): string {
  try {
    const url = new URL(value);
    requireProvider(url.protocol === "https:" && !url.username && !url.password && !url.search &&
      !url.hash && (!originOnly || url.pathname === "/"), "provider_configuration_invalid");
    return originOnly ? url.origin : url.href;
  } catch { throw new ProductionProviderError("provider_configuration_invalid"); }
}

export interface ProviderHttpOptions {
  /** Return a short-lived service credential; never persisted or cached by AgentProof. */
  getToken: (signal: AbortSignal) => Promise<string>;
  /** Whole operation deadline, including credential retrieval and response streaming. Default 10s. */
  timeoutMs?: number;
}

/** Capture configuration before the first await. No request or credential lookup on construction. */
export function providerPost(endpoint: string, options: ProviderHttpOptions, tokenHeader: string,
  tokenPrefix = "", extraHeaders: Record<string, string> = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const getToken = options.getToken;
  const headers = { ...extraHeaders };
  const transport = globalThis.fetch;
  requireProvider(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000 &&
    typeof getToken === "function" && typeof transport === "function", "provider_configuration_invalid");

  return async (body: string): Promise<unknown> => {
    requireProvider(Buffer.byteLength(body) <= MAX_PROVIDER_BYTES, "provider_input_invalid");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProductionProviderError("provider_timeout"));
        controller.abort();
      }, timeoutMs);
    });
    const operation = async () => {
      let token: string;
      try { token = await getToken(controller.signal); }
      catch { throw new ProductionProviderError("provider_credentials_unavailable"); }
      // A late credential callback must never start a request after its deadline.
      requireProvider(!controller.signal.aborted, "provider_timeout");
      requireProvider(typeof token === "string" && /^[\x21-\x7e]{1,4096}$/.test(token),
        "provider_credentials_unavailable");
      const response = await transport(endpoint, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        signal: controller.signal, body,
        headers: { ...headers, "content-type": "application/json", accept: "application/json",
          [tokenHeader]: tokenPrefix + token },
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new ProductionProviderError("provider_timeout");
      }
      requireProvider(response.status === 200 && !response.redirected, "provider_unavailable");
      requireProvider(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json" &&
        response.body, "provider_response_invalid");
      const reader = response.body.getReader();
      const cancelRead = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener("abort", cancelRead, { once: true });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          requireProvider(!controller.signal.aborted, "provider_timeout");
          if (chunk.done) break;
          size += chunk.value.byteLength;
          requireProvider(size <= MAX_PROVIDER_BYTES, "provider_response_invalid");
          chunks.push(chunk.value);
        }
      } finally {
        controller.signal.removeEventListener("abort", cancelRead);
        cancelRead();
      }
      try {
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        parseJsonStrict(raw); // Reject duplicate keys before ordinary JSON parsing.
        const value: unknown = JSON.parse(raw);
        const safeKeys = (item: unknown, depth: number): void => {
          requireProvider(depth <= 64, "provider_response_invalid");
          if (item && typeof item === "object") {
            requireProvider(!Object.hasOwn(item, "__proto__"), "provider_response_invalid");
            for (const child of Object.values(item)) safeKeys(child, depth + 1);
          }
        };
        safeKeys(value, 0);
        return value;
      } catch { throw new ProductionProviderError("provider_response_invalid"); }
    };
    try { return await Promise.race([deadline, operation()]); }
    catch (error) {
      if (error instanceof ProductionProviderError) throw error;
      throw new ProductionProviderError("provider_unavailable");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
