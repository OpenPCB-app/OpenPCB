import { createServer, Server } from "http";

/**
 * OAuth callback listener interface
 * Provides methods to wait for callback and close the server
 */
export interface OAuthListener {
  /**
   * Wait for OAuth callback to be received
   * @returns Promise that resolves with the callback URL containing authorization code
   */
  waitForCallback(): Promise<URL>;

  /**
   * Close the callback server
   * @returns Promise that resolves when server is closed
   */
  close(): Promise<void>;
}

/**
 * Start an OAuth callback listener server
 * Binds to localhost only for security
 * Automatically times out after 5 minutes
 *
 * @param port - Port number to listen on (e.g., 1455 for Codex)
 * @param callbackPath - Path to listen for callbacks (e.g., "/oauth/callback")
 * @returns Promise resolving to OAuthListener interface
 * @throws Error if port is already in use or other server error
 */
export async function startOAuthListener(
  port: number,
  callbackPath: string
): Promise<OAuthListener> {
  const origin = `http://localhost:${port}`;
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  let resolveCallback: ((url: URL) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;

  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  // Set up timeout to reject if no callback received
  const timeout = setTimeout(() => {
    if (rejectCallback) {
      rejectCallback(new Error("OAuth timeout (5 minutes)"));
    }
    // Attempt to close server on timeout
    server.close();
  }, TIMEOUT_MS);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", origin);

    // Only handle requests to the specified callback path
    if (url.pathname !== callbackPath) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    // Serve success HTML page
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<html><body><h1>Success!</h1><p>You can close this tab.</p></body></html>"
    );

    // Clear timeout and resolve with callback URL
    clearTimeout(timeout);

    if (resolveCallback) {
      resolveCallback(url);
    }

    // Close server after sending response
    setImmediate(() => {
      server.close();
    });
  });

  // Start server with error handling
  await new Promise<void>((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} already in use`));
      } else {
        reject(err);
      }
    });

    // Bind to 127.0.0.1 only for security (localhost only)
    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });

  return {
    waitForCallback: () => callbackPromise,
    close: () =>
      new Promise((resolve) => {
        clearTimeout(timeout);
        server.close(() => resolve());
      }),
  };
}
