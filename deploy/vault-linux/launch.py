#!/usr/bin/python3
"""Read a systemd private credential without shell expansion or secret argv."""
import sys
sys.dont_write_bytecode = True
import json
import os
from pathlib import Path
from appliance import protected_reference

root = Path(__file__).resolve().parents[2]
try:
    credential_dir = Path(os.environ['CREDENTIALS_DIRECTORY'])
    settings = json.loads((credential_dir / 'machine-env').read_text())
    if not isinstance(settings, dict) or any(not k.startswith('VAULT_') or not isinstance(v, str) or '\x00' in v for k, v in settings.items()):
        raise ValueError('Invalid environment')
    manifest = json.loads((root / 'release.json').read_text())
    protected_reference(settings['VAULT_CONFIG_PUBLIC_KEY_PATH'])
    if settings.get('VAULT_CONTROLLER_ADAPTER') == 'WAVESHARE':
        protected_reference(settings['VAULT_WAVESHARE_CONFIG_PATH'])
    if settings.get('VAULT_PAYMENT_ADAPTER') in ('NAYAX_SPARK_TEST', 'NAYAX_SPARK_PRODUCTION'):
        protected_reference(settings['VAULT_SPARK_CONFIG_PATH'])
    if settings.get('VAULT_PAYMENT_ADAPTER') == 'NAYAX_SPARK_PRODUCTION':
        for name in ('VAULT_SPARK_PROVISIONING_PATH', 'VAULT_SPARK_ACTIVATION_PATH'):
            protected_reference(settings[name])
        protected_reference('/etc/tenkings-vault/spark-activation-public.pem')
        protected_reference('/etc/tenkings-vault/release-public.pem')
        evidence = Path(settings['VAULT_SPARK_EVIDENCE_PATH'])
        for kind in ('NAYAX_CERTIFICATION', 'TERMINAL_SANDBOX', 'CABINET_ACCEPTANCE', 'LINUX_RELEASE', 'PRODUCTION_ACCOUNT'):
            protected_reference(evidence / (kind + '.evidence'))
            protected_reference(evidence / (kind + '.artifact'))
    # These values belong to this exact packaged release, not operator input.
    settings.update({
        'VAULT_DATABASE_PATH': '/var/lib/tenkings-vault/vault.sqlite',
        'VAULT_LOG_PATH': '/var/log/tenkings-vault/machine.jsonl',
        'VAULT_BIND_HOST': '127.0.0.1', 'VAULT_PORT': '47831',
        'VAULT_KIOSK_ORIGIN': 'http://127.0.0.1:47831',
        'VAULT_KIOSK_STATIC_ROOT': str(root / 'frontend/vault-kiosk/dist'),
        'VAULT_APP_VERSION': manifest['appVersion'],
        'VAULT_SOURCE_COMMIT': manifest['sourceCommit'],
        'VAULT_RELEASE_ROOT': str(root),
        'VAULT_RELEASE_PUBLIC_KEY_PATH': '/etc/tenkings-vault/release-public.pem',
        'VAULT_SPARK_ACTIVATION_PUBLIC_KEY_PATH': '/etc/tenkings-vault/spark-activation-public.pem',
    })
    env = {'PATH': str(root / 'runtime/bin') + ':/usr/bin:/bin', 'HOME': '/var/lib/tenkings-vault', 'LANG': 'C.UTF-8', 'TZ': 'UTC', **settings}
    os.umask(0o077)
    os.chdir(root)
    os.execve(root / 'runtime/bin/node', [str(root / 'runtime/bin/node'), str(root / 'packages/vault-machine/dist/cli.js')], env)
except Exception:
    # Never interpolate values from config or exceptions into the journal.
    raise SystemExit('Vault launch failed: verify protected configuration and signed release')
