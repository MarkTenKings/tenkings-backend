import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
const [configuration, common, start, install, update, synthetic] = await Promise.all([
  'atlas-nfc-configuration.ps1', 'ai-grader-nfc-helper-common.ps1',
  'start-ai-grader-nfc-helper.ps1', 'install-ai-grader-nfc-helper.ps1',
  'update-ai-grader-nfc-helper.ps1', 'tests/test-atlas-nfc-configuration.ps1',
].map(read));
const csharp = await readFile(new URL('../../packages/ai-grader-nfc-helper/src/TenKings.AiGrader.NfcHelper/AtlasServerTrust.cs', root), 'utf8');

test('stable installation payload includes optional configuration validator and launcher calls it', () => {
  assert.match(common, /\. \(Join-Path \$PSScriptRoot "atlas-nfc-configuration\.ps1"\)/);
  assert.match(common, /"ai-grader-nfc-helper-common\.ps1",\s*"atlas-nfc-configuration\.ps1",/);
  assert.match(common, /Assert-AtlasNfcConfig -Config \$config \| Out-Null\s*return \$config/);
  assert.match(start, /Invoke-NfcWithAtlasEnvironment -Config \$config -ArgumentList @\(\$dll\) -Action/);
  assert.match(start, /& dotnet \$helperDll \| Out-Host\s*return \$LASTEXITCODE/);
});

test('dedicated environment names and trust purpose stay aligned with C# runtime', () => {
  for (const exact of ['ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON', 'atlas-nfc-helper-trust-v1']) {
    assert.ok(configuration.includes(exact));
    assert.ok(csharp.includes(exact));
  }
  assert.ok(configuration.includes('atlas-program-approved-report-url-v1'));
  assert.match(configuration, /\$token\.Value -cnotmatch '\\A\[A-Za-z0-9_-\]\{43,192\}\\z'/);
  assert.match(configuration, /\$token\.Value -ceq \[string\]\$Config\.workstationToken/);
  assert.match(configuration, /\$ForbiddenKeyIds -ccontains \$entry\.keyId/);
  assert.match(configuration, /\$forbidden \+= \[string\]\$legacy\.prior\.keyId/);
});

test('configuration helper cannot persist config, provision keys, launch helper, or enable during update/install', () => {
  assert.doesNotMatch(configuration, /(?:Save-NfcConfig|Set-Content|WriteAll|Start-Process|Start-ScheduledTask|CngKey|ECDsaCng|Invoke-RestMethod|& dotnet|SetEnvironmentVariable\([^\n]*EnvironmentVariableTarget\]::(?:User|Machine))/);
  assert.doesNotMatch(install + update, /atlasNfcEnabled\s*=/);
  assert.doesNotMatch(update, /(?:Save-NfcConfig|Initialize-NfcConfig|RotateToken|RotatePairingCode)/);
  assert.match(update, /Get-NfcPreservedStateSnapshot/);
  assert.match(update, /Assert-NfcPreservedState/);
});

test('inherited values are validated before action and two-variable cleanup is nested', () => {
  const scope = configuration.slice(configuration.indexOf('function Invoke-NfcWithAtlasEnvironment'));
  assert.ok(scope.indexOf('Unmanaged inherited') < scope.indexOf('& $Action'));
  assert.match(scope, /\$null -eq \$values\[\$name\] -or \$previous\[\$name\] -cne \$values\[\$name\]/);
  assert.match(scope, /finally \{[\s\S]*try \{[\s\S]*\$previous\['ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON'\][\s\S]*finally \{[\s\S]*\$previous\['ATLAS_NFC_WORKSTATION_TOKEN'\]/);
  assert.doesNotMatch(scope, /EnvironmentVariableTarget\]::(?:User|Machine)/);
});

test('PowerShell public-only P-256 fixture matches standard SPKI and curve algebra', () => {
  const base64 = synthetic.match(/\$publicSpki = '([^']+)'/)[1];
  const der = Buffer.from(base64, 'base64');
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1');
  assert.equal(der.length, 91);
  const hex = der.toString('hex');
  const prefix = configuration.match(/hex\.StartsWith\('([^']+)'/)[1];
  assert.equal(prefix.length, 54);
  assert.ok(hex.startsWith(prefix));
  const p = BigInt(`0x${configuration.match(/\$prime = .*Parse\('([^']+)'/)[1]}`);
  const b = BigInt(`0x${configuration.match(/\$curveB = .*Parse\('([^']+)'/)[1]}`);
  const x = BigInt(`0x${hex.slice(54, 118)}`);
  const y = BigInt(`0x${hex.slice(118, 182)}`);
  assert.ok(x < p && y < p);
  assert.equal((y * y - x * x * x + 3n * x - b) % p, 0n);
  assert.notEqual(((y ^ 1n) ** 2n - x ** 3n + 3n * x - b) % p, 0n);
  assert.doesNotMatch(synthetic, /(?:Start-Process|Start-ScheduledTask|& dotnet|Read-NfcConfig|Save-NfcConfig|New-NfcSecret|CngKey|HttpListener)/);
});
