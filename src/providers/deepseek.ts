/**
 * Deepseek provider вЂ” direct API calls (OpenAI-compatible).
 * Implements a tool-use loop with streaming support.
 */
import type {
  AIProvider,
  ModelInfo,
  ProviderQueryOptions,
  ProviderEvent,
  ToolCall,
  ProviderMessage,
} from "./types.js";
import { STANDARD_TOOLS, executeToolCall } from "./types.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "deepseek-chat", label: "DeepSeek Chat (V3)" },
];

export class DeepseekProvider implements AIProvider {
  readonly id = "deepseek";
  readonly label = "DeepSeek";
  readonly models = DEEPSEEK_MODELS;

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async validateAuth(): Promise<boolean> {
    try {
      const res = await fetch(`${DEEPSEEK_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async *query(opts: ProviderQueryOptions): AsyncGenerator<ProviderEvent, void> {
    const startTime = Date.now();
    let turns = 0;
    let totalInput = 0;
    let totalOutput = 0;

    const messages: ProviderMessage[] = [];

    // Build system message
    const systemPrompt = opts.systemPrompt ||
      `You are Claude Code, an interactive CLI tool. You are running inside Claude-TG via the DeepSeek provider. ` +
      `Working directory: ${opts.cwd}. You have access to tools: read_file, write_file, run_command, ` +
      `search_files, search_content, web_fetch. Use them to help the user. Be concise and direct.`;

    messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: opts.prompt });

    try {
      while (turns < (opts.maxTurns || 50)) {
        if (opts.abortSignal.aborted) break;
        turns++;

        // Create a yield callback for the streaming method
        const streamEvents: ProviderEvent[] = [];
        const onEvent = (e: ProviderEvent) => { streamEvents.push(e); };

        const streamResult = await this._streamChat(messages, opts, onEvent);
        totalInput += streamResult.usage.inputTokens;
        totalOutput += streamResult.usage.outputTokens;

        // Relay streamed events
        for (const e of streamEvents) {
          if (opts.abortSignal.aborted) break;
          yield e;
        }

        if (opts.abortSignal.aborted) break;

        // If the model returned a final text response (no tool calls)
        if (!streamResult.toolCalls || streamResult.toolCalls.length === 0) {
          yield {
            type: "result",
            subtype: "success",
            text: streamResult.content,
            usage: { inputTokens: totalInput, outputTokens: totalOutput },
            turns,
            durationMs: Date.now() - startTime,
          };
          return;
        }

        // Execute tool calls
        messages.push({
          role: "assistant",
          content: streamResult.content,
          tool_calls: streamResult.toolCalls,
        });

        for (const tc of streamResult.toolCalls) {
          if (opts.abortSignal.aborted) break;

          const toolName = tc.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // Bad JSON вЂ” skip
          }

          yield { type: "status", status: `Using ${toolName}...` };

          const result = await executeToolCall(toolName, args, opts.cwd);

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }

        // Yield status for UI
        yield { type: "status", status: "Reasoning..." };
      }
    } catch (err) {
      if (opts.abortSignal.aborted) return;
      yield {
        type: "result",
        subtype: "error",
        text: "",
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
        turns,
        durationMs: Date.now() - startTime,
        errors: [(err as Error).message],
      };
    }
  }

  /** Stream a chat completion and return the full response */
  private async _streamChat(
    messages: ProviderMessage[],
    opts: ProviderQueryOptions,
    onEvent: (e: ProviderEvent) => void,
  ): Promise<{
    content: string;
    toolCalls: ToolCall[];
    usage: { inputTokens: number; outputTokens: number };
  }> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      stream: true,
      tools: STANDARD_TOOLS,
      tool_choice: "auto",
    };

    if (opts.effort && opts.effort !== "medium") {
      body.reasoning_effort = opts.effort;
    }

    const res = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.abortSignal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Deepseek API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    let content = "";
    const toolCalls: ToolCall[] = [];
    const toolCallDeltas = new Map<number, { id: string; name: string; args: string }>();
    let inputTokens = 0;
    let outputTokens = 0;

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (opts.abortSignal.aborted) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data);
          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Track usage from final chunk
          if (chunk.usage) {
            inputTokens += chunk.usage.prompt_tokens || 0;
            outputTokens += chunk.usage.completion_tokens || 0;
          }

          const delta = choice.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            content += delta.content;
            onEvent({ type: "text_delta", text: delta.content });
          }

          // Tool calls (streamed as deltas)
          if (delta.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index ?? 0;

              if (!toolCallDeltas.has(idx)) {
                toolCallDeltas.set(idx, {
                  id: tcDelta.id || "",
                  name: tcDelta.function?.name || "",
                  args: "",
                });
              }

              const entry = toolCallDeltas.get(idx)!;
              if (tcDelta.id) entry.id = tcDelta.id;
              if (tcDelta.function?.name) entry.name = tcDelta.function.name;
              if (tcDelta.function?.arguments) entry.args += tcDelta.function.arguments;
            }
          }

          // Stop reason
          if (choice.finish_reason === "tool_calls") {
            // Consolidate tool call deltas into ToolCall array
            for (const [, entry] of toolCallDeltas) {
              toolCalls.push({
                id: entry.id,
                type: "function",
                function: {
                  name: entry.name,
                  arguments: entry.args,
                },
              });
            }
            onEvent({ type: "tool_call_end" });
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    // Flush remaining buffer
    if (buffer.startsWith("data: ") && buffer.slice(6).trim() !== "[DONE]") {
      try {
        const chunk = JSON.parse(buffer.slice(6).trim());
        if (chunk.usage) {
          inputTokens += chunk.usage.prompt_tokens || 0;
          outputTokens += chunk.usage.completion_tokens || 0;
        }
      } catch {}
    }

    return { content, toolCalls, usage: { inputTokens, outputTokens } };
  }
}
