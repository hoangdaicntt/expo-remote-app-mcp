import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { log } from "./logger.js";

const START_WS_PORT = Number.parseInt(process.env.EXPO_REMOTE_WS_PORT ?? "2000", 10);
const COMMAND_TIMEOUT_MS = Number.parseInt(
  process.env.EXPO_REMOTE_COMMAND_TIMEOUT_MS ?? "15000",
  10,
);

type BridgeCommand = {
  id: string;
  command: "take_screenshot" | "navigate";
  payload?: Record<string, unknown>;
};

export type AppResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type PendingCommand = {
  resolve: (response: AppResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

let appSocket: WebSocket | null = null;
let currentWsPort = START_WS_PORT;
const pendingCommands = new Map<string, PendingCommand>();

function isSocketOpen(socket: WebSocket | null): socket is WebSocket {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

function rejectPendingCommands(reason: string) {
  for (const [id, pending] of pendingCommands) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
    pendingCommands.delete(id);
  }
}

function parseAppResponse(data: RawData): AppResponse | null {
  try {
    const parsed = JSON.parse(data.toString()) as Partial<AppResponse>;

    if (typeof parsed.id !== "string" || typeof parsed.ok !== "boolean") {
      return null;
    }

    return {
      id: parsed.id,
      ok: parsed.ok,
      result: parsed.result,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return null;
  }
}

export function normalizeBase64Image(value: unknown): string {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "object" &&
          value !== null &&
          "base64" in value &&
          typeof value.base64 === "string"
        ? value.base64
        : null;

  if (!raw) {
    throw new Error("Expo app returned an invalid screenshot payload.");
  }

  return raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

export async function sendCommandToApp(command: Omit<BridgeCommand, "id">): Promise<AppResponse> {
  if (!isSocketOpen(appSocket)) {
    throw new Error(
      `Expo app is not connected. Start the app and connect it to ws://<computer-lan-ip>:${currentWsPort}.`,
    );
  }

  const id = randomUUID();
  const message: BridgeCommand = { id, ...command };

  return new Promise<AppResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`Timed out waiting for Expo response to ${command.command}.`));
    }, COMMAND_TIMEOUT_MS);

    pendingCommands.set(id, { resolve, reject, timeout });

    appSocket!.send(JSON.stringify(message), (error) => {
      if (!error) {
        return;
      }

      clearTimeout(timeout);
      pendingCommands.delete(id);
      reject(error);
    });
  });
}

function attachWebSocketHandlers(wss: WebSocketServer) {
  wss.on("connection", (socket, request) => {
    if (appSocket && appSocket !== socket) {
      log("Replacing existing Expo WebSocket client with the newest connection.");
      appSocket.close(1000, "Replaced by a newer Expo client connection.");
    }

    appSocket = socket;
    log(`Expo app connected from ${request.socket.remoteAddress ?? "unknown address"}.`);

    socket.on("message", (data) => {
      const response = parseAppResponse(data);

      if (!response) {
        log("Ignored malformed response from Expo app.");
        return;
      }

      const pending = pendingCommands.get(response.id);
      if (!pending) {
        log(`Ignored response for unknown request id ${response.id}.`);
        return;
      }

      clearTimeout(pending.timeout);
      pendingCommands.delete(response.id);
      pending.resolve(response);
    });

    socket.on("close", () => {
      if (appSocket === socket) {
        appSocket = null;
        rejectPendingCommands("Expo app disconnected before responding.");
      }

      log("Expo app disconnected.");
    });

    socket.on("error", (error) => {
      log(`Expo WebSocket error: ${error.message}`);
    });
  });

  wss.on("listening", () => {
    log(`WebSocket bridge listening on ws://0.0.0.0:${currentWsPort}.`);
  });
}

function isAddressInUseError(error: Error): boolean {
  return "code" in error && error.code === "EADDRINUSE";
}

function listenOnAvailablePort(port: number) {
  currentWsPort = port;
  const wss = new WebSocketServer({ port });

  attachWebSocketHandlers(wss);

  wss.on("error", (error) => {
    if (isAddressInUseError(error)) {
      log(`WebSocket port ${port} is already in use. Trying ${port + 1}.`);
      wss.close(() => listenOnAvailablePort(port + 1));
      return;
    }

    log(`WebSocket server error: ${error.message}`);
  });
}

export function startWebSocketBridge() {
  listenOnAvailablePort(START_WS_PORT);
}
