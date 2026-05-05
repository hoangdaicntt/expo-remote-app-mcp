import { createRequire } from "node:module";
import { log } from "./logger.js";

const require = createRequire(import.meta.url);
const CDP = require("chrome-remote-interface") as CdpFactory;

export const LOG_LIMIT = 100;

const METRO_CDP_JSON_URL = process.env.EXPO_REMOTE_CDP_JSON_URL ?? "http://localhost:8081/json";

type CdpFactory = (options?: { target?: string; local?: boolean }) => Promise<CdpClient>;

type CdpEventRegistration<TParams> = (listener: (params: TParams) => void) => void;

type CdpClient = {
  Network: {
    enable: () => Promise<void>;
    requestWillBeSent: CdpEventRegistration<NetworkRequestWillBeSentEvent>;
    responseReceived: CdpEventRegistration<NetworkResponseReceivedEvent>;
  };
  Runtime: {
    enable: () => Promise<void>;
    evaluate: (params: {
      expression: string;
      returnByValue: boolean;
    }) => Promise<RuntimeEvaluateResult>;
    consoleAPICalled: CdpEventRegistration<RuntimeConsoleApiCalledEvent>;
    exceptionThrown: CdpEventRegistration<RuntimeExceptionThrownEvent>;
  };
  Fetch: {
    enable: (params: { patterns: Array<{ urlPattern: string }> }) => Promise<void>;
    requestPaused: CdpEventRegistration<FetchRequestPausedEvent>;
    fulfillRequest: (params: {
      requestId: string;
      responseCode: number;
      responseHeaders?: Array<{ name: string; value: string }>;
      body?: string;
    }) => Promise<void>;
    continueRequest: (params: { requestId: string }) => Promise<void>;
  };
  on: (event: "disconnect" | "error", listener: (error?: Error) => void) => void;
};

type CdpTarget = {
  title?: string;
  type?: string;
  url?: string;
  description?: string;
  webSocketDebuggerUrl?: string;
};

type HeaderMap = Record<string, unknown>;

type NetworkRequestWillBeSentEvent = {
  requestId: string;
  type?: string;
  request: {
    url: string;
    method: string;
    headers?: HeaderMap;
  };
};

type NetworkResponseReceivedEvent = {
  requestId: string;
  response: {
    status: number;
    headers?: HeaderMap;
  };
};

type RemoteObject = {
  type?: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
};

type RuntimeConsoleApiCalledEvent = {
  type: string;
  args?: RemoteObject[];
};

type RuntimeExceptionThrownEvent = {
  exceptionDetails: {
    text?: string;
    exception?: RemoteObject;
    stackTrace?: unknown;
  };
};

type RuntimeEvaluateResult = {
  result?: RemoteObject;
  exceptionDetails?: RuntimeExceptionThrownEvent["exceptionDetails"];
};

type FetchRequestPausedEvent = {
  requestId: string;
  request: {
    url: string;
  };
};

type NetworkLog = {
  requestId: string;
  timestamp: string;
  url: string;
  method: string;
  headers: HeaderMap;
  resourceType?: string;
  status?: number;
  responseHeaders?: HeaderMap;
};

type RuntimeLog = {
  timestamp: string;
  type: "console" | "exception";
  level: "error" | "warning";
  message: string;
  args?: string[];
  stackTrace?: unknown;
};

type MockRule = {
  urlPattern: string;
  mockStatus: number;
  mockBody: string;
};

let cdpClient: CdpClient | null = null;
let cdpConnectingPromise: Promise<CdpClient> | null = null;
let fetchRequestPausedListenerInstalled = false;

const mockRules = new Map<string, MockRule>();
const networkLogs: NetworkLog[] = [];
const appErrorsAndLogs: RuntimeLog[] = [];

function pushLimited<T>(items: T[], item: T) {
  items.push(item);

  if (items.length > LOG_LIMIT) {
    items.splice(0, items.length - LOG_LIMIT);
  }
}

function serializeRemoteObject(value: RemoteObject | undefined): string {
  if (!value) {
    return "";
  }

  if ("value" in value) {
    return typeof value.value === "string"
      ? value.value
      : (JSON.stringify(value.value) ?? String(value.value));
  }

  return value.unserializableValue ?? value.description ?? value.type ?? "";
}

function findRuntimeTarget(targets: CdpTarget[]): CdpTarget | null {
  const targetsWithDebugger = targets.filter((target) => target.webSocketDebuggerUrl);

  return (
    targetsWithDebugger.find((target) => {
      const searchable = [
        target.title,
        target.type,
        target.url,
        target.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        searchable.includes("hermes") ||
        searchable.includes("react native") ||
        searchable.includes("react-native")
      );
    }) ??
    targetsWithDebugger[0] ??
    null
  );
}

async function getMetroDebuggerTarget(): Promise<CdpTarget> {
  const response = await fetch(METRO_CDP_JSON_URL);

  if (!response.ok) {
    throw new Error(`Metro CDP endpoint returned HTTP ${response.status}.`);
  }

  const targets = (await response.json()) as CdpTarget[];

  if (!Array.isArray(targets)) {
    throw new Error("Metro CDP endpoint returned an invalid target list.");
  }

  const target = findRuntimeTarget(targets);

  if (!target?.webSocketDebuggerUrl) {
    throw new Error("No React Native/Hermes CDP target with a WebSocket debugger URL was found.");
  }

  return target;
}

export async function connectCdpClient(): Promise<CdpClient> {
  if (cdpClient) {
    return cdpClient;
  }

  if (cdpConnectingPromise) {
    return cdpConnectingPromise;
  }

  cdpConnectingPromise = (async () => {
    const target = await getMetroDebuggerTarget();
    const client = await CDP({ target: target.webSocketDebuggerUrl, local: true });
    cdpClient = client;
    fetchRequestPausedListenerInstalled = false;

    client.on("disconnect", () => {
      log("CDP client disconnected.");
      cdpClient = null;
      fetchRequestPausedListenerInstalled = false;
    });

    client.on("error", (error) => {
      log(`CDP client error: ${error?.message ?? "unknown error"}`);
    });

    client.Network.requestWillBeSent((params) => {
      pushLimited(networkLogs, {
        requestId: params.requestId,
        timestamp: new Date().toISOString(),
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers ?? {},
        resourceType: params.type,
      });
    });

    client.Network.responseReceived((params) => {
      const logItem = [...networkLogs].reverse().find((item) => item.requestId === params.requestId);

      if (!logItem) {
        return;
      }

      logItem.status = params.response.status;
      logItem.responseHeaders = params.response.headers ?? {};
    });

    client.Runtime.consoleAPICalled((params) => {
      if (params.type !== "error" && params.type !== "warning") {
        return;
      }

      const args = params.args?.map(serializeRemoteObject) ?? [];

      pushLimited(appErrorsAndLogs, {
        timestamp: new Date().toISOString(),
        type: "console",
        level: params.type,
        message: args.join(" "),
        args,
      });
    });

    client.Runtime.exceptionThrown((params) => {
      pushLimited(appErrorsAndLogs, {
        timestamp: new Date().toISOString(),
        type: "exception",
        level: "error",
        message:
          params.exceptionDetails.text ??
          serializeRemoteObject(params.exceptionDetails.exception) ??
          "Unhandled exception",
        args: [serializeRemoteObject(params.exceptionDetails.exception)].filter(Boolean),
        stackTrace: params.exceptionDetails.stackTrace,
      });
    });

    await client.Network.enable();
    await client.Runtime.enable();

    if (mockRules.size > 0) {
      await enableFetchMocks(client);
    }

    log(`CDP connected to ${target.title ?? target.url ?? "React Native target"}.`);
    return client;
  })();

  try {
    return await cdpConnectingPromise;
  } catch (error) {
    cdpClient = null;
    throw new Error(
      `Unable to connect to Metro CDP at ${METRO_CDP_JSON_URL}. Make sure Metro is running on localhost:8081 and the React Native debugger target is available. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    cdpConnectingPromise = null;
  }
}

function makeCdpPatternRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function findMockRuleForUrl(url: string): MockRule | undefined {
  return [...mockRules.values()].find((rule) => makeCdpPatternRegex(rule.urlPattern).test(url));
}

function installFetchRequestPausedListener(client: CdpClient) {
  if (fetchRequestPausedListenerInstalled) {
    return;
  }

  client.Fetch.requestPaused((params) => {
    void (async () => {
      const rule = findMockRuleForUrl(params.request.url);

      if (!rule) {
        await client.Fetch.continueRequest({ requestId: params.requestId });
        return;
      }

      await client.Fetch.fulfillRequest({
        requestId: params.requestId,
        responseCode: rule.mockStatus,
        responseHeaders: [
          { name: "Content-Type", value: "application/json; charset=utf-8" },
          { name: "Access-Control-Allow-Origin", value: "*" },
        ],
        body: Buffer.from(rule.mockBody, "utf8").toString("base64"),
      });
    })().catch((error) => {
      log(`Failed to fulfill mocked request: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  fetchRequestPausedListenerInstalled = true;
}

async function enableFetchMocks(client: CdpClient) {
  installFetchRequestPausedListener(client);
  await client.Fetch.enable({
    patterns: [...mockRules.values()].map((rule) => ({ urlPattern: rule.urlPattern })),
  });
}

export async function getNetworkTraffic(limit?: number): Promise<NetworkLog[]> {
  await connectCdpClient();
  return typeof limit === "number" ? networkLogs.slice(-limit) : [...networkLogs];
}

export async function getLatestErrors(limit?: number, clear?: boolean): Promise<RuntimeLog[]> {
  await connectCdpClient();

  const logs = typeof limit === "number" ? appErrorsAndLogs.slice(-limit) : [...appErrorsAndLogs];

  if (clear) {
    if (typeof limit === "number") {
      appErrorsAndLogs.splice(Math.max(appErrorsAndLogs.length - limit, 0));
    } else {
      appErrorsAndLogs.length = 0;
    }
  }

  return logs;
}

export async function evaluateJavaScript(code: string) {
  const client = await connectCdpClient();
  const evaluation = await client.Runtime.evaluate({
    expression: code,
    returnByValue: true,
  });

  if (evaluation.exceptionDetails) {
    return {
      ok: false,
      error:
        evaluation.exceptionDetails.text ??
        serializeRemoteObject(evaluation.exceptionDetails.exception) ??
        "JavaScript evaluation failed.",
      exceptionDetails: evaluation.exceptionDetails,
    };
  }

  return {
    ok: true,
    result: evaluation.result?.value ?? serializeRemoteObject(evaluation.result),
  };
}

export async function mockApiEndpoint(rule: MockRule): Promise<void> {
  const client = await connectCdpClient();

  mockRules.set(rule.urlPattern, rule);
  await enableFetchMocks(client);
}
