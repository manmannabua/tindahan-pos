import { describe, expect, it, vi } from "vitest";

import { buildUrl, createApiClient } from "./client";
import { ApiError, NetworkError } from "./errors";

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(responses: Array<(init: RequestInit, url: string) => Response | Promise<Response>>) {
  let token: string | null = "old-token";
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    return next(init ?? {}, url);
  });
  const refreshAccessToken = vi.fn(async (): Promise<string | null> => {
    token = "new-token";
    return token;
  });
  const onUnauthenticated = vi.fn();
  const client = createApiClient({
    fetchFn: fetchFn as unknown as typeof fetch,
    getAccessToken: () => token,
    refreshAccessToken,
    onUnauthenticated,
  });
  const authHeader = (i: number) => (calls[i].init.headers as Record<string, string>).Authorization;
  return { client, calls, fetchFn, refreshAccessToken, onUnauthenticated, authHeader, setToken: (t: string | null) => (token = t) };
}

describe("buildUrl", () => {
  it("prefixes the API version and drops empty query values", () => {
    expect(buildUrl("", "/users", { q: "ana", offset: 0, x: undefined, y: "" })).toBe(
      "/api/v1/users?q=ana&offset=0",
    );
  });
});

describe("createApiClient", () => {
  it("sends the bearer token and CSRF header, and parses JSON", async () => {
    const { client, calls, authHeader } = setup([() => json(200, { ok: true })]);
    await expect(client.get("/auth/me")).resolves.toEqual({ ok: true });
    expect(authHeader(0)).toBe("Bearer old-token");
    expect((calls[0].init.headers as Record<string, string>)["X-Requested-With"]).toBe("pos");
    expect(calls[0].init.credentials).toBe("same-origin");
  });

  it("serializes JSON bodies", async () => {
    const { client, calls } = setup([() => json(201, { id: "1" })]);
    await client.post("/branches", { code: "B2" });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ code: "B2" }));
  });

  it("returns undefined for 204", async () => {
    const { client } = setup([() => new Response(null, { status: 204 })]);
    await expect(client.delete("/roles/1")).resolves.toBeUndefined();
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const { client, refreshAccessToken, authHeader, onUnauthenticated } = setup([
      () => json(401, { error: { code: "auth.invalid_token", message: "expired" } }),
      () => json(200, { id: "me" }),
    ]);
    await expect(client.get("/auth/me")).resolves.toEqual({ id: "me" });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(authHeader(1)).toBe("Bearer new-token");
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it("shares one refresh across concurrent 401s (single flight)", async () => {
    const unauthorized = () => json(401, { error: { code: "auth.invalid_token", message: "x" } });
    const { client, refreshAccessToken } = setup([
      unauthorized,
      unauthorized,
      unauthorized,
      () => json(200, 1),
      () => json(200, 2),
      () => json(200, 3),
    ]);
    const results = await Promise.all([client.get("/a"), client.get("/b"), client.get("/c")]);
    expect(results.sort()).toEqual([1, 2, 3]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("signals unauthenticated when refresh fails", async () => {
    const { client, refreshAccessToken, onUnauthenticated, fetchFn } = setup([
      () => json(401, { error: { code: "auth.invalid_token", message: "x" } }),
    ]);
    refreshAccessToken.mockResolvedValueOnce(null);
    await expect(client.get("/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1); // no retry without a token
  });

  it("does not refresh for unauthenticated requests", async () => {
    const { client, refreshAccessToken } = setup([
      () => json(401, { error: { code: "auth.invalid_credentials", message: "bad" } }),
    ]);
    await expect(client.request("/auth/login", { method: "POST", auth: false, body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("parses the error envelope into ApiError", async () => {
    const { client } = setup([
      () =>
        json(422, {
          error: {
            code: "validation_error",
            message: "Request validation failed",
            details: { errors: [{ loc: ["body", "email"], msg: "invalid email", type: "value_error" }] },
          },
        }),
    ]);
    const error = await client.post("/users", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("validation_error");
    expect(apiError.fieldErrors).toEqual({ email: "invalid email" });
  });

  it("handles non-JSON error bodies", async () => {
    const { client } = setup([() => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" })]);
    await expect(client.get("/x")).rejects.toMatchObject({ code: "http_502", status: 502 });
  });

  it("wraps fetch failures as NetworkError", async () => {
    const { client } = setup([
      () => {
        throw new TypeError("Failed to fetch");
      },
    ]);
    await expect(client.get("/x")).rejects.toBeInstanceOf(NetworkError);
  });
});
