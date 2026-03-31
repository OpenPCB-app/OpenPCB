


export type RustClient = {
    isConnected: boolean;
    request: (method: string, params?: any) => Promise<any>;
    on: (event: string, callback: (data: any) => void) => void;
}

let rustClient: RustClient | undefined = undefined;

export function getRustClient(): RustClient {
    // TODO implement UNIX Domain Socket communication with Rust 
    if (!rustClient) throw new Error("RustClient not initialized");
    return rustClient;
}