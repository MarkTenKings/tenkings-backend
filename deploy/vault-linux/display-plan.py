#!/usr/bin/python3
"""Generate a portrait config from read-only Hyprland device observations.

Prints a Lua fragment only. It never reloads the compositor or changes touch.
The configured monitor and touch device are explicit, never the first device.
"""
import argparse
import json
import re
import subprocess

def plan(monitors, devices, output, touch, transform):
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', output) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', touch):
        raise ValueError('Use exact observed monitor/touch names without control characters')
    matches = [m for m in monitors if m.get('name') == output]
    if len(matches) != 1 or len([d for d in devices.get('touch', []) if d.get('name') == touch]) != 1:
        raise ValueError('Configured monitor or touch device is absent or ambiguous')
    if transform not in [1, 3]: raise ValueError('Portrait transform must be 1 or 3')
    return '\n'.join([
        '-- REVIEW: merge with this installed Omarchy version, then verify four corners and center.',
        '-- Monitor native mode must actually be 1920x1080; do not infer the received model.',
        f'hl.monitor({{ output = "{output}", mode = "preferred", position = "auto", scale = 1, transform = {transform} }})',
        'hl.env("GDK_SCALE", "1")',
        '-- Bind the observed touch device to this output in this version\'s per-device input section:',
        f'-- touch device: {touch}; output: {output}; transform: {transform}',
        '-- Touch syntax varies by installed Hyprland version; inspect its shipped input configuration.',
        '-- Autostart entry for ~/.config/hypr/autostart.lua:',
        'o.launch_on_start("/opt/tenkings-vault/current/deploy/vault-linux/kiosk-session.sh")',
    ])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True); parser.add_argument('--touch', required=True)
    parser.add_argument('--transform', type=int, choices=[1, 3], required=True)
    args = parser.parse_args()
    try:
        monitors = json.loads(subprocess.check_output(['hyprctl', '-j', 'monitors', 'all'], text=True, timeout=5))
        devices = json.loads(subprocess.check_output(['hyprctl', '-j', 'devices'], text=True, timeout=5))
        print(plan(monitors, devices, args.output, args.touch, args.transform))
    except Exception:
        raise SystemExit('Display plan unavailable; inspect the local Hyprland version and connected identities')
