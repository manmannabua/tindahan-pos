import { createPublicKey, verify } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DeviceClient } from "./device-client";
import { challengeMessage, exportPublicKey, fromBase64, generateDeviceKeys, signChallenge } from "./keys";

describe("device keys", () => {
  it("private key is not extractable", async () => {
    const keys = await generateDeviceKeys();
    expect(keys.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", keys.privateKey)).rejects.toThrow();
  });

  it("signatures verify with the exported SPKI key (what the backend does)", async () => {
    const keys = await generateDeviceKeys();
    const spki = await exportPublicKey(keys);
    const signature = await signChallenge(keys, "dev-1", "nonce-abc");
    expect(fromBase64(signature)).toHaveLength(64); // raw r||s (IEEE P1363)

    const publicKey = createPublicKey({ key: Buffer.from(spki, "base64"), format: "der", type: "spki" });
    const message = Buffer.from(challengeMessage("dev-1", "nonce-abc"));
    const sig = Buffer.from(signature, "base64");
    expect(verify("sha256", message, { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
    expect(verify("sha256", Buffer.from(challengeMessage("dev-1", "other")), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(false);
  });
});

describe("DeviceClient", () => {
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  it("authenticates once (single flight), caches the token and re-authenticates on 401", async () => {
    const keys = await generateDeviceKeys();
    let tokens = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/challenge")) return json({ nonce: "n1234567890123456", expires_in: 60 });
      if (path.endsWith("/devices/token")) {
        tokens += 1;
        return json({ access_token: `tok${tokens}`, expires_in: 3600 });
      }
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth === "Bearer tok1" && path.includes("/sync/context") && tokens === 1) return json({ error: { code: "auth.invalid_token", message: "expired" } }, 401);
      return json({ ok: true, auth });
    });
    const client = new DeviceClient({ getCredentials: async () => ({ deviceId: "dev-1", keys }), fetchFn });

    const [a, b] = await Promise.all([client.token(), client.token()]);
    expect(a).toBe("tok1");
    expect(b).toBe("tok1");
    expect(tokens).toBe(1);

    const result = await client.request<{ auth: string }>("/sync/context");
    expect(result.auth).toBe("Bearer tok2");
    expect(tokens).toBe(2);
  });

  it("fails clearly when the terminal is not registered", async () => {
    const client = new DeviceClient({ getCredentials: async () => null, fetchFn: vi.fn() });
    await expect(client.token()).rejects.toThrow("not registered");
  });
});
