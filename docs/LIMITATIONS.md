# Limitations

1. **A subagent inside the builder session is not a FreshEye.** Grok gives that subagent the parent's skills, permissions, and connected MCP servers, and a memory-enabled session still injects its memory index. FreshEye starts a separate `grok --no-memory --no-leader` process instead.

2. **Instruction files.** `agents_md: false` did not stop Grok from attaching `~/.claude/CLAUDE.md`. The process also sets `GROK_CLAUDE_AGENTS_ENABLED=0`, `GROK_CLAUDE_RULES_ENABLED=0`, and the matching Cursor switches. A project `AGENTS.md` inside the working tree can still be attached when that tree is a git repo. The workspace remains readable: if the prompt names a findings file, FreshEye can open it.

3. **Skills and MCP.** Claude and Cursor skill scans are off for the process. Grok still attaches its skill catalog to the prompt. That catalog is descriptions, not this conversation and not the memory index. The model is not given `search_tool` or `use_tool`. User MCP servers, including Cyclops Chat, can still start. They are not in the model's tool list. A check of session `01a16aba-2b03-7472-8f5f-7567a90bc25d` showed memory off, no instruction files, tools `read_file`, `list_dir`, and `grep`, and Cyclops Chat still starting in the background.

4. **A terminal chat stays open. The builder window does not become that chat.** From a terminal, `grok-fresheye "…"` starts a new Grok session and stays in it. Follow-ups are messages in that chat. The Rift status script is unchanged. The status command prints Rift's lines, then `◎ FreshEye · Fresh Context` on a FreshEye session. Grok reads that command when the chat starts, so a chat already open before the change needs to be started again. A call with no terminal, including `/fresheye` from a builder turn, prints one reply and exits. `--chat` without a terminal stops and tells you to open one.

5. **The prompt is on disk.** `~/.local/state/cyclops-fresheye-grok/last-prompt.txt` is the latest full prompt, mode `0600`. The ledger stores the first 80 characters. A one-shot prints the review. A chat keeps the rest of the conversation in the fresh session.

6. **`source.png` is refused on purpose.** For this Chroma work that path is the colour-field input, not the rendered projection. A look will not send it.

7. **Plan mode and tool removal are best-effort.** If a future Grok build ignores `permission_mode: plan` or an unknown name in `--disallowed-tools`, the process can do more than read. The agent text still says not to change files.
