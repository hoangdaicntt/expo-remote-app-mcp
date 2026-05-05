#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  connectCdpClient,
  evaluateJavaScript,
  getLatestErrors,
  getNetworkTraffic,
  LOG_LIMIT,
  mockApiEndpoint,
} from "./cdp.js";
import { normalizeBase64Image, sendCommandToApp, startWebSocketBridge } from "./bridge.js";
import { log } from "./logger.js";

async function startMcpServer() {
  const server = new McpServer({
    name: "expo-remote-app-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "take_screenshot",
    {
      title: "Take Screenshot",
      description: "Capture the current screen of the connected Expo app.",
    },
    async () => {
      const response = await sendCommandToApp({ command: "take_screenshot" });

      if (!response.ok) {
        throw new Error(response.error ?? "Expo app failed to take a screenshot.");
      }

      return {
        content: [
          {
            type: "image",
            data: normalizeBase64Image(response.result),
            mimeType: "image/png",
          },
        ],
      };
    },
  );

  server.registerTool(
    "navigate",
    {
      title: "Navigate",
      description: "Navigate the connected Expo app to a screen or Expo Router path.",
      inputSchema: {
        screenName: z.string().min(1).describe("Expo Router path or screen name to navigate to."),
      },
    },
    async ({ screenName }) => {
      const response = await sendCommandToApp({
        command: "navigate",
        payload: { screenName },
      });

      if (!response.ok) {
        throw new Error(response.error ?? `Expo app failed to navigate to ${screenName}.`);
      }

      const message =
        typeof response.result === "string"
          ? response.result
          : `Navigated to ${screenName}.`;

      return {
        content: [{ type: "text", text: message }],
      };
    },
  );

  server.registerTool(
    "get_network_traffic",
    {
      title: "Get Network Traffic",
      description: "Returns the list of recent API requests made by the app.",
      inputSchema: {
        limit: z.number().int().min(1).max(LOG_LIMIT).optional(),
      },
    },
    async ({ limit }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await getNetworkTraffic(limit), null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    "get_latest_errors",
    {
      title: "Get Latest Errors",
      description:
        "Returns recent console errors, warnings, and unhandled exceptions from the React Native JS runtime.",
      inputSchema: {
        limit: z.number().int().min(1).max(LOG_LIMIT).optional(),
        clear: z.boolean().optional().describe("Clear returned errors after reading them."),
      },
    },
    async ({ limit, clear }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await getLatestErrors(limit, clear), null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    "evaluate_js",
    {
      title: "Evaluate JavaScript",
      description: "Executes arbitrary JavaScript code directly in the React Native runtime.",
      inputSchema: {
        code: z.string().min(1).describe("JavaScript expression or snippet to evaluate."),
      },
    },
    async ({ code }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await evaluateJavaScript(code), null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    "mock_api_endpoint",
    {
      title: "Mock API Endpoint",
      description: "Intercepts a specific API request and returns a mock response or error status.",
      inputSchema: {
        urlPattern: z
          .string()
          .min(1)
          .describe("CDP Fetch URL pattern to intercept, such as *://localhost:3000/users*"),
        mockStatus: z.number().int().min(100).max(599),
        mockBody: z.string(),
      },
    },
    async ({ urlPattern, mockStatus, mockBody }) => {
      await mockApiEndpoint({ urlPattern, mockStatus, mockBody });

      return {
        content: [
          {
            type: "text",
            text: `Mock enabled for ${urlPattern} with HTTP ${mockStatus}.`,
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected over stdio.");
}

startWebSocketBridge();
connectCdpClient().catch((error) => {
  log(error instanceof Error ? error.message : String(error));
});
startMcpServer().catch((error) => {
  log(`Fatal MCP server error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
