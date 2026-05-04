import {
  type NavigationContainerRefWithCurrent,
  createNavigationContainerRef,
  NavigationContainer,
} from "@react-navigation/native";
import { PropsWithChildren, useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import ViewShot, { captureRef } from "react-native-view-shot";

const DEFAULT_BRIDGE_URL = "ws://192.168.1.10:8080";
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
  bridgeUrl?: string;
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

export function RemoteControlBridge({
  bridgeUrl = DEFAULT_BRIDGE_URL,
  enabled = __DEV__,
  navigationRef = defaultRemoteNavigationRef,
  children,
}: RemoteControlBridgeProps) {
  const socketRef = useRef<WebSocket | null>(null);
  const viewShotRef = useRef<ViewShot>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);

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

  const connect = useCallback(() => {
    if (!enabled) {
      return;
    }

    if (!shouldReconnectRef.current) {
      return;
    }

    const socket = new WebSocket(bridgeUrl);
    socketRef.current = socket;

    socket.onmessage = (message) => {
      void handleCommand(socket, message);
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }, [bridgeUrl, enabled, handleCommand]);

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
