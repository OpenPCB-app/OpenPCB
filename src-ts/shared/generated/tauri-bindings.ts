type BridgeInvokePayload = {
  namespace: string;
  command: string;
  payload: Record<string, unknown>;
};

type BridgeInvokeOk = {
  status: "ok";
  data: unknown;
};

type BridgeInvokeErr = {
  status: "error";
  error: { message: string };
};

export const commands = {
  async bridgeInvoke(_input: BridgeInvokePayload): Promise<BridgeInvokeOk | BridgeInvokeErr> {
    return {
      status: "error",
      error: {
        message: "Tauri bridge unavailable in browser mode",
      },
    };
  },
};
