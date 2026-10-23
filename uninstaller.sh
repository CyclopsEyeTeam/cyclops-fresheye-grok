#!/bin/bash
# Remove the Grok FreshEye links. The ledger stays unless --purge is given.
# --purge deletes ~/.local/state/cyclops-fresheye-grok only. It does not touch the agy store.
set -euo pipefail

PURGE=0
if [[ "${1:-}" == "--purge" ]]; then
  PURGE=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: ./uninstaller.sh [--purge]" >&2
  exit 1
fi

rm -f "$HOME/.local/bin/grok-fresheye"
if [[ -L "$HOME/.grok/plugins/cyclops-fresheye" ]]; then
  rm "$HOME/.grok/plugins/cyclops-fresheye"
fi

CONFIG="$HOME/.grok/config.toml"
if [[ -f "$CONFIG" ]]; then
  python3 - "$CONFIG" << 'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
text2 = text.replace('enabled = ["cyclops-rift", "cyclops-fresheye"]', 'enabled = ["cyclops-rift"]', 1)
if text2 != text:
    path.write_text(text2)
    print("config: removed cyclops-fresheye from enabled")
else:
    print("config: no cyclops-fresheye enabled entry to remove")
PY
  python3 - "$CONFIG" << 'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
rift = 'command = "~/.grok/plugins/cyclops-rift/rift/statusline.py"'
fresh = 'command = "~/.grok/plugins/cyclops-fresheye/scripts/statusline.js"'
if fresh in text:
    path.write_text(text.replace(fresh, rift, 1))
    print("config: restored the Rift status line command")
else:
    print("config: FreshEye status line command was not set")
PY
fi

if [[ "$PURGE" == 1 ]]; then
  STATE="${XDG_STATE_HOME:-$HOME/.local/state}/cyclops-fresheye-grok"
  rm -rf "$STATE"
  echo "purged $STATE"
fi

echo "Uninstalled Grok FreshEye."
