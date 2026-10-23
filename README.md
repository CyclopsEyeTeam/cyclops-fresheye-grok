# Cyclops FreshEye for Grok

Same model, clean context. The review runs in a new Grok process. That process does not receive the builder conversation.

Claude FreshEye does this with `/clear` inside Claude Code, and withholds the instruction-file block. Antigravity FreshEye does it with `inheritCustomizations: false`. Grok's in-chat subagent still receives memory, skills, and the parent's MCP servers, so this port does not use one. `grok-fresheye` starts `grok --no-memory` on the `fresheye` agent (`agents_md: false`, no inherited MCP).

## Use it on a Chroma projection

A look sends the question and the picture paths. It does not send the builder's verdict.

```bash
grok-fresheye look \
  --image /path/to/frame-a.png \
  --image /path/to/frame-b.png \
  --question "What stays put, and what changes?"
```

The fresh process has to open each image with its read tool. `source.png` is refused: that file is the colour-field input, not the rendered projection. When a change could be the camera, a transform of the drawing, or the colour field, the prompt tells it to say unknown.

Inside a Grok session the same request is `/fresheye`. The session must not add its own conclusion to the question.

## Other reviews

From a terminal, a prompt opens a new Grok chat and stays there, so you can send a follow-up. The Rift status line stays. That chat adds `◎ FreshEye · Fresh Context` on the status row. An ordinary Grok session does not get the mark. In another terminal, `grok-fresheye status` shows which original the chat is paired with.

```bash
grok-fresheye "Read src/parser.ts and tests/parser.test.ts. What does the first test miss?"
grok-fresheye status
grok-fresheye log 20
grok-fresheye resume
```

`resume` in a terminal reopens that chat. `--print` only prints the command. `--switch` reopens it too.

A call with no terminal prints one reply and exits. That is what `/fresheye` inside a Grok turn needs. `--once` forces the single reply. `--chat` forces the chat, and refuses when there is no terminal.

Pairs and the ledger live in `~/.local/state/cyclops-fresheye-grok/store.json`. That file is separate from Antigravity FreshEye's store. The ledger keeps the first 80 characters of each prompt.

## Install

```bash
./installer.sh
```

The installer links this directory into `~/.grok/plugins/cyclops-fresheye`, links `grok-fresheye` onto `PATH`, and adds the plugin beside Cyclops Rift. It does not change the Rift status line. A new Grok session picks up `/fresheye`.

`./uninstaller.sh` removes the links. `./uninstaller.sh --purge` also deletes the Grok ledger.
