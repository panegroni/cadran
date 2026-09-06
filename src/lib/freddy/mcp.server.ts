import { FREDDY_MCP_URL } from "./constants";
import { extractToolText } from "./parse";

type JsonRpc = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export class McpHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class FreddyMcp {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private readonly token: string) {}

  async initialize() {
    const body = await this.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "Cadran", version: "1.0.0" },
    });
    if (body.error) {
      throw new Error(body.error.message ?? "initialize a échoué");
    }
    await this.notify("notifications/initialized");
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const body = await this.rpc("tools/call", {
      name,
      arguments: args,
    });
    if (body.error) {
      throw new Error(body.error.message ?? `${name} a échoué`);
    }
    const result = body.result as { isError?: boolean } | undefined;
    const text = extractToolText(result ?? body.result);
    if (result?.isError) {
      throw new Error(text || `${name} a renvoyé une erreur`);
    }
    return text;
  }

  private async notify(method: string) {
    await this.post({ jsonrpc: "2.0", method });
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpc> {
    const id = this.nextId++;
    const parsed = await this.post({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Réponse MCP vide (${method})`);
    }
    return parsed as JsonRpc;
  }

  private async post(payload: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.token}`,
      "mcp-protocol-version": "2025-03-26",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const res = await fetch(FREDDY_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;

    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new McpHttpError(res.status, text || "non autorisé");
    }
    if (!res.ok) {
      throw new McpHttpError(
        res.status,
        text.slice(0, 280) || `HTTP ${res.status}`,
      );
    }
    if (!text) return { jsonrpc: "2.0", result: null };
    return parseMcpBody(res.headers.get("content-type"), text);
  }
}

function parseMcpBody(contentType: string | null, text: string): unknown {
  const ctype = contentType ?? "";
  if (ctype.includes("text/event-stream")) {
    const events: unknown[] = [];
    for (const block of text.split("\n\n")) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        events.push(JSON.parse(data));
      } catch {
        /* ignore malformed SSE */
      }
    }
    const rpc = events.find(
      (event) => event && typeof event === "object" && "id" in event,
    );
    return rpc ?? events.at(-1) ?? null;
  }
  return JSON.parse(text);
}
