import {
  type NavigationContainerRefWithCurrent,
  createNavigationContainerRef,
  NavigationContainer,
} from "@react-navigation/native";
import { PropsWithChildren, useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import ViewShot, { captureRef } from "react-native-view-shot";

const DEFAULT_BRIDGE_IP = "192.168.1.10";
const BRIDGE_START_PORT = 2000;
const BRIDGE_END_PORT = 2020;
const CONNECT_TIMEOUT_MS = 500;
const SCAN_NEXT_PORT_DELAY_MS = 50;
const RECONNECT_DELAY_MS = 1500;

declare const __DEV__: boolean;

export const defaultRemoteNavigationRef = createNavigationContainerRef();

type AnyNavigationRef = NavigationContainerRefWithCurrent<any>;

type BridgeCommand = {
  id: string;
  command: "take_screenshot" | "navigate";
  payload?: {
    screenName?: string;
  };
};

type BridgeResponse =
  | {
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      id: string;
      ok: false;
      error: string;
    };

type RemoteControlBridgeProps = PropsWithChildren<{
  bridgeIp?: string;
  enabled?: boolean;
  navigationRef?: AnyNavigationRef;
}>;

function sendResponse(socket: WebSocket | null, response: BridgeResponse) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(response));
  }
}

function navigateByScreenName(
  navigationRef: AnyNavigationRef,
  screenName: string,
) {
  if (!navigationRef.isReady()) {
    throw new Error("Navigation container is not ready.");
  }

  navigationRef.navigate(screenName as never);
}

function normalizeBridgeIp(bridgeIp: string) {
  return bridgeIp.replace(/^wss?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
}

function getBridgeUrl(bridgeIp: string, port: number) {
  return `ws://${normalizeBridgeIp(bridgeIp)}:${port}`;
}

export function RemoteControlBridge({
  bridgeIp = DEFAULT_BRIDGE_IP,
  enabled = __DEV__,
  navigationRef = defaultRemoteNavigationRef,
  children,
}: RemoteControlBridgeProps) {
  const socketRef = useRef<WebSocket | null>(null);
  const viewShotRef = useRef<ViewShot>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);
  const connectedPortRef = useRef<number | null>(null);

  const handleCommand = useCallback(async (socket: WebSocket, message: MessageEvent) => {
    let command: BridgeCommand;

    try {
      command = JSON.parse(String(message.data)) as BridgeCommand;
    } catch {
      return;
    }

    if (!command.id || !command.command) {
      return;
    }

    try {
      if (command.command === "take_screenshot") {
        const base64 = await captureRef(viewShotRef, {
          format: "png",
          quality: 0.8,
          result: "base64",
        });

        sendResponse(socket, {
          id: command.id,
          ok: true,
          result: { base64 },
        });
        return;
      }

      if (command.command === "navigate") {
        const screenName = command.payload?.screenName;

        if (!screenName) {
          throw new Error("Missing payload.screenName.");
        }

        navigateByScreenName(navigationRef, screenName);

        sendResponse(socket, {
          id: command.id,
          ok: true,
          result: `Navigated to ${screenName}.`,
        });
        return;
      }

      throw new Error(`Unsupported command: ${command.command}`);
    } catch (error) {
      sendResponse(socket, {
        id: command.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [navigationRef]);

  const connect = useCallback((port = connectedPortRef.current ?? BRIDGE_START_PORT) => {
    if (!enabled) {
      return;
    }

    if (!shouldReconnectRef.current) {
      return;
    }

    const nextPort = port > BRIDGE_END_PORT ? BRIDGE_START_PORT : port;
    const socket = new WebSocket(getBridgeUrl(bridgeIp, nextPort));
    socketRef.current = socket;

    connectTimerRef.current = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      connectedPortRef.current = nextPort;

      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
    };

    socket.onmessage = (message) => {
      void handleCommand(socket, message);
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }

      const wasConnected = connectedPortRef.current === nextPort;
      if (wasConnected) {
        connectedPortRef.current = null;
      }

      const reconnectPort = wasConnected ? nextPort : nextPort + 1;
      const reconnectDelay = wasConnected ? RECONNECT_DELAY_MS : SCAN_NEXT_PORT_DELAY_MS;

      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          connect(reconnectPort);
        }, reconnectDelay);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }, [bridgeIp, enabled, handleCommand]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
      }

      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect, enabled]);

  if (!enabled) {
    return <NavigationContainer ref={navigationRef}>{children}</NavigationContainer>;
  }

  return (
    <ViewShot ref={viewShotRef} style={{ flex: 1 }}>
      <View style={{ flex: 1 }} collapsable={false}>
        <NavigationContainer ref={navigationRef}>{children}</NavigationContainer>
      </View>
    </ViewShot>
  );
}
