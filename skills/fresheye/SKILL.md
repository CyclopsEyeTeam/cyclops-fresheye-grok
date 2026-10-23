---
name: fresheye
description: >
  Open a same-model FreshEye review whose process does not receive this
  conversation or cross-session memory. Use when the user runs /fresheye,
  asks for a fresh eye or an unprimed second look, or wants a clean look at
  Chroma or Electric Eye projection images.
argument-hint: '["prompt"] or look --image <png> --question "..."'
---

# /fresheye

Do not answer the review yourself. A subagent in this session still receives memory, skills, and connected MCP servers. FreshEye is a separate process.

## With a prompt

This session cannot hand over a terminal. Pass `--once` so the review is printed here. A person who wants the chat itself runs `grok-fresheye` in a terminal, without `--once`.

1. If the request is a look at Chroma, Electric Eye, or rendered projection images, run `grok-fresheye look --once`. Pass each projection image with `--image`, in order, and pass only the question with `--question`. Do not put this conversation's verdict, expected result, or earlier notes in the question. Do not pass a file named `source.png`.
2. Otherwise run `grok-fresheye run --once` and give it the user's words with nothing added from this conversation.
3. Pass `--origin "$GROK_SESSION_ID"` and `--cwd` as this workspace.
4. Show the review under `◎ FreshEye · Fresh Context`. Add one line with the fresh session id. A follow-up is a message in that chat: the person runs `grok-fresheye resume` in a terminal. Do not launch that chat from this session. Do not rewrite the review using what this conversation already believes.

## With no prompt

Run `grok-fresheye status` and show that output. Do not invent a pair.
