/**
 * Multi-provider types for Claude-TG.
 * Claude (Agent SDK) and Deepseek (direct API) share this interface.
 */

// в”Ђв”Ђ Model info в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export interface ModelInfo {
  id: string;
  label: string;
}

// в”Ђв”Ђ Tool definitions (OpenAI/Deepseek compatible format) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

// Standard tools available to all providers
export const STANDARD_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file at the given path",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file to read" },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, overwriting if it exists",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command and return its output",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          cwd: { type: "string", description: "Working directory for the command" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for files matching a glob pattern",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)" },
          path: { type: "string", description: "Directory to search in" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_content",
      description: "Search file contents using regex",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "File or directory to search in" },
          glob: { type: "string", description: "Optional glob filter for files" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch content from a URL",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
        },
        required: ["url"],
      },
    },
  },
];

// в”Ђв”Ђ Tool call в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// в”Ђв”Ђ Messages в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export interface ProviderMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

// в”Ђв”Ђ Stream events в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; id: string; name: string; arguments: string }
  | { type: "tool_call_end" }
  | { type: "status"; status: string }
  | { type: "error"; message: string };

export type ResultEvent = {
  type: "result";
  subtype: "success" | "error";
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  turns: number;
  durationMs: number;
  errors?: string[];
};

export type ProviderEvent = StreamEvent | ResultEvent;

// в”Ђв”Ђ Query options в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export interface ProviderQueryOptions {
  prompt: string;
  model: string;
  cwd: string;
  env: Record<string, string | undefined>;
  maxTurns?: number;
  effort?: "low" | "medium" | "high" | "max";
  abortSignal: AbortSignal;
  systemPrompt?: string;
}

// в”Ђв”Ђ Provider interface в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  readonly models: readonly ModelInfo[];

  /** Stream query results as an async iterable of events */
  query(options: ProviderQueryOptions): AsyncGenerator<ProviderEvent, void>;

  /** Validate that the provider is properly configured (API key, etc.) */
  validateAuth(): Promise<boolean>;
}

// в”Ђв”Ђ Tool execution в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string
): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { execSync } = await import("node:child_process");

  switch (toolName) {
    case "read_file": {
      const file = args.file_path as string;
      if (!file) return "Error: file_path required";
      const fullPath = path.resolve(cwd, file);
      try {
        return fs.readFileSync(fullPath, "utf-8").slice(0, 50_000);
      } catch (err) {
        return `Error reading file: ${(err as Error).message}`;
      }
    }

    case "write_file": {
      const fp = args.file_path as string;
      const content = args.content as string;
      if (!fp) return "Error: file_path required";
      const fullPath = path.resolve(cwd, fp);
      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, "utf-8");
        return `File written: ${fp}`;
      } catch (err) {
        return `Error writing file: ${(err as Error).message}`;
      }
    }

    case "run_command": {
      const cmd = args.command as string;
      if (!cmd) return "Error: command required";
      const workDir = (args.cwd as string) || cwd;
      try {
        const output = execSync(cmd, {
          cwd: path.resolve(cwd, workDir),
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
          encoding: "utf-8",
          shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
        });
        return output.slice(0, 10_000) || "(no output)";
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return `Error: ${e.message}\n${e.stderr || ""}\n${e.stdout || ""}`.slice(0, 5000);
      }
    }

    case "search_files": {
      const pattern = args.pattern as string;
      const dir = (args.path as string) || cwd;
      try {
        const fullDir = path.resolve(cwd, dir);
        // Simple glob implementation using recursive readdir
        const results: string[] = [];
        function walk(d: string, maxDepth = 10) {
          if (maxDepth <= 0) return;
          try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
              const full = path.join(d, entry.name);
              if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                walk(full, maxDepth - 1);
              } else if (entry.isFile()) {
                results.push(path.relative(fullDir, full));
              }
            }
          } catch {}
        }
        walk(fullDir);
        // Basic glob matching
        const mmPattern = pattern.replace(/\*\*/g, "___DOUBLESTAR___").replace(/\*/g, "[^/]*").replace(/___DOUBLESTAR___/g, ".*");
        const re = new RegExp(`^${mmPattern}$`);
        const filtered = results.filter((f) => re.test(f)).slice(0, 100);
        return filtered.length > 0 ? filtered.join("\n") : `No files matching "${pattern}"`;
      } catch (err) {
        return `Error searching files: ${(err as Error).message}`;
      }
    }

    case "search_content": {
      const rgPattern = args.pattern as string;
      const dir = (args.path as string) || cwd;
      if (!rgPattern) return "Error: pattern required";
      try {
        const fullDir = path.resolve(cwd, dir);
        const lines: string[] = [];
        function searchDir(d: string, maxDepth = 8) {
          if (maxDepth <= 0) return;
          try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
              const full = path.join(d, entry.name);
              if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                searchDir(full, maxDepth - 1);
              } else if (entry.isFile() && entry.name.match(/\.(ts|js|json|md|txt|html|css|py|gd|yml|yaml|sh|toml)$/)) {
                try {
                  const content = fs.readFileSync(full, "utf-8");
                  const re = new RegExp(rgPattern, "gm");
                  let match;
                  while ((match = re.exec(content)) !== null) {
                    const lineNum = content.slice(0, match.index).split("\n").length;
                    const ctx = content.split("\n")[lineNum - 1]?.trim().slice(0, 120);
                    lines.push(`${path.relative(fullDir, full)}:${lineNum}: ${ctx}`);
                    if (lines.length >= 200) return;
                  }
                } catch {}
              }
            }
          } catch {}
        }
        searchDir(fullDir);
        return lines.length > 0 ? lines.slice(0, 200).join("\n") : `No matches for "${rgPattern}"`;
      } catch (err) {
        return `Error searching content: ${(err as Error).message}`;
      }
    }

    case "web_search": {
      return "Web search is not available in the direct provider. Try the Claude provider for web access.";
    }

    case "web_fetch": {
      const url = args.url as string;
      if (!url) return "Error: url required";
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        const text = await res.text();
        return text.slice(0, 20_000);
      } catch (err) {
        return `Error fetching URL: ${(err as Error).message}`;
      }
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
