#!/bin/bash
# Install Cyclops FreshEye for Grok. Safe to run again.
# Leaves the Rift status script in place and points the row at a stacker
# that prints Rift, then a FreshEye mark only inside a FreshEye session.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_LINK="$HOME/.grok/plugins/cyclops-fresheye"
BIN_LINK="$HOME/.local/bin/grok-fresheye"
CONFIG="$HOME/.grok/config.toml"

if [[ ! -f "$ROOT/plugin.json" || ! -f "$ROOT/agents/fresheye.md" ]]; then
  echo "installer: $ROOT is not the FreshEye plugin" >&2
  exit 1
fi

mkdir -p "$HOME/.grok/plugins" "$HOME/.local/bin"
ln -sfn "$ROOT" "$PLUGIN_LINK"
ln -sfn "$ROOT/bin/grok-fresheye" "$BIN_LINK"
chmod +x "$ROOT/bin/grok-fresheye" "$ROOT/scripts/fresheye-ctl.js" "$ROOT/scripts/statusline.js" "$ROOT/installer.sh" "$ROOT/uninstaller.sh"

python3 - "$CONFIG" << 'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text() if path.exists() else ""
needle = 'enabled = ["cyclops-rift"]'
insert = 'enabled = ["cyclops-rift", "cyclops-fresheye"]'
if "cyclops-fresheye" in text:
    print("config: cyclops-fresheye already enabled")
elif needle in text:
    path.write_text(text.replace(needle, insert, 1))
    print("config: enabled cyclops-fresheye next to cyclops-rift")
elif "[plugins]" in text and "enabled" in text:
    sys.exit("config: [plugins] enabled list is not the expected cyclops-rift line; add cyclops-fresheye by hand")
else:
    path.write_text(text.rstrip() + "\n\n[plugins]\nenabled = [\"cyclops-fresheye\"]\n")
    print("config: added [plugins] enabled")
PY

python3 - "$CONFIG" << 'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text() if path.exists() else ""
rift = 'command = "~/.grok/plugins/cyclops-rift/rift/statusline.py"'
fresh = 'command = "~/.grok/plugins/cyclops-fresheye/scripts/statusline.js"'
if fresh in text:
    print("config: FreshEye mark already stacked on the Rift status line")
elif rift in text:
    path.write_text(text.replace(rift, fresh, 1))
    print("config: stacked a FreshEye mark on the Rift status line")
else:
    print("config: status line is not the Rift command; left it alone")
PY

grok plugin validate "$ROOT"
echo "Installed. Open a new Grok session, then /fresheye or: grok-fresheye look --image <png> --question \"...\""
