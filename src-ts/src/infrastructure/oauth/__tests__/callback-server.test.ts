import { describe, expect, it, afterEach } from "bun:test";
import { startOAuthListener } from "../callback-server";

describe("Callback Server", () => {
  let listener: Awaited<ReturnType<typeof startOAuthListener>> | null = null;

  afterEach(async () => {
    if (listener) {
      await listener.close();
      listener = null;
    }
  });

  it("starts server on specified port", async () => {
    listener = await startOAuthListener(51122, "/oauth/callback");
    expect(listener).toBeDefined();
  });

  it("receives callback with code", async () => {
    const port = 51123;
    listener = await startOAuthListener(port, "/oauth/callback");
    
    const callbackPromise = listener.waitForCallback();
    const response = await fetch(
      `http://127.0.0.1:${port}/oauth/callback?code=test_code&state=test_state`
    );
    
    expect(response.status).toBe(200);
    const callbackUrl = await callbackPromise;
    expect(callbackUrl.searchParams.get("code")).toBe("test_code");
    expect(callbackUrl.searchParams.get("state")).toBe("test_state");
  });

  it("times out after 5 minutes", async () => {
    listener = await startOAuthListener(51124, "/oauth/callback");
    const promise = listener.waitForCallback();
    const result = await Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);
    
    expect(result).toBe("timeout");
  }, 200);
});
