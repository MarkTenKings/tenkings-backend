#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Local prerequisite observations only. Fixed commands never open PC/SC, query
// tag memory, retrieve a private key, sign, submit to Apple, or dispatch print.
// Nothing here can qualify a printer, a firmware family, or a production station.
const COMMANDS = Object.freeze({
  macos: ['/usr/bin/sw_vers', ['-productVersion']],
  identities: ['/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']],
  notarytool: ['/usr/bin/xcrun', ['--find', 'notarytool']],
  stapler: ['/usr/bin/xcrun', ['--find', 'stapler']],
  printers: ['/usr/bin/lpstat', ['-p']],
  usb: ['/usr/sbin/system_profiler', ['SPUSBDataType', '-json', '-detailLevel', 'mini', '-timeout', '10']],
});
const requireValue = (ok, code) => { if (!ok) throw new Error(code); };

export function localInspectionCommand(command, args) {
  const result = spawnSync(command, args, { shell: false, encoding: 'utf8', timeout: 12000,
    maxBuffer: 2 * 1024 * 1024, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR, LANG: 'C', LC_ALL: 'C', CUPS_SERVER: '/private/var/run/cupsd' } });
  // Raw subprocess text is private to the parser; never return it in the report.
  return { status: result.status, stdout: result.stdout ?? '', error: result.error?.code ?? null };
}

export function parseSigningIdentities(raw) {
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const summary = lines.at(-1)?.match(/^(\d+) valid identities found$/);
  requireValue(summary && Number(summary[1]) <= 1000, 'IDENTITIES_RESPONSE_INVALID');
  const identities = lines.slice(0, -1).map(line => {
    const item = line.match(/^\d+\) ([A-Fa-f0-9]{40}) "([^"\r\n]+)"$/);
    requireValue(item, 'IDENTITIES_RESPONSE_INVALID');
    return { sha1: item[1].toUpperCase(), name: item[2] };
  });
  requireValue(identities.length === Number(summary[1]) && new Set(identities.map(row => row.sha1)).size === identities.length,
    'IDENTITIES_RESPONSE_INVALID');
  return { validIdentityCount: identities.length, developerIdApplications: identities.flatMap(row => {
    const match = row.name.match(/^Developer ID Application: .+ \(([A-Z0-9]{10})\)$/);
    // Public certificate selectors only. Omit personal certificate subject names.
    return match ? [{ certificateSha1: row.sha1, teamId: match[1] }] : [];
  }) };
}

export function parseUsbReaders(raw) {
  const data = JSON.parse(raw);
  requireValue(data && Array.isArray(data.SPUSBDataType), 'USB_RESPONSE_INVALID');
  const readers = [];
  const text = value => typeof value === 'string' && /^[\x20-\x7E]{1,160}$/.test(value) ? value : null;
  const id = value => typeof value === 'string' ? value.match(/^0x([a-f0-9]{4})(?:\s|$)/i)?.[1]?.toUpperCase() ?? null : null;
  let entries = 0;
  function visit(list, depth = 0) {
    requireValue(depth <= 16 && Array.isArray(list), 'USB_RESPONSE_INVALID');
    for (const entry of list) {
      requireValue(entry && typeof entry === 'object' && !Array.isArray(entry) && ++entries <= 4096, 'USB_RESPONSE_INVALID');
      if (/ACR1552/i.test(entry._name ?? '')) readers.push({
        reportedProduct: text(entry._name), reportedManufacturer: text(entry.manufacturer),
        vendorId: id(entry.vendor_id), productId: id(entry.product_id),
        // USB bcdDevice/product text is not the documented ACS firmware getter.
        reportedUsbVersion: text(entry.bcd_device), subtypeConfirmed: false, firmwareQueried: false,
      });
      if (Object.hasOwn(entry, '_items')) visit(entry._items, depth + 1);
    }
  }
  visit(data.SPUSBDataType);
  return { matchingDeviceCount: readers.length, readers };
}

export function inspectMac({ execute = localInspectionCommand, platform = process.platform,
  architecture = process.arch, nodeVersion = process.versions.node, now = () => new Date() } = {}) {
  requireValue(platform === 'darwin', 'MAC_INSPECTION_DARWIN_REQUIRED');
  function observe(key, parse) {
    const [command, args] = COMMANDS[key];
    let response;
    try { response = execute(command, [...args]); }
    catch { return { status: 'UNKNOWN', reason: 'INSPECTION_COMMAND_FAILED' }; }
    if (response?.status !== 0 || response?.error || typeof response?.stdout !== 'string')
      return { status: 'UNKNOWN', reason: 'INSPECTION_COMMAND_FAILED' };
    try { return { status: 'OBSERVED', ...parse(response.stdout) }; }
    catch { return { status: 'UNKNOWN', reason: 'INSPECTION_RESPONSE_INVALID' }; }
  }
  const macos = observe('macos', raw => {
    const version = raw.trim(); requireValue(/^\d+\.\d+(?:\.\d+)?$/.test(version), 'MACOS_RESPONSE_INVALID');
    return { version, meetsMinimumMacOS15: Number(version.split('.')[0]) >= 15 };
  });
  const signing = observe('identities', parseSigningIdentities);
  const tool = raw => { requireValue(/^\/[^\r\n]+$/.test(raw.trim()), 'TOOL_RESPONSE_INVALID'); return { available: true }; };
  const notarytool = observe('notarytool', tool), stapler = observe('stapler', tool);
  const printers = observe('printers', raw => {
    const lines = raw.split(/\r?\n/).filter(line => line.trim());
    const queues = lines.map(line => line.match(/^printer ([A-Za-z0-9_.-]{1,127})\s/)?.[1]);
    requireValue(queues.every(Boolean) && new Set(queues).size === queues.length, 'PRINTER_RESPONSE_INVALID');
    return { queues, selectedProductionQueue: null, physicallyQualified: false };
  });
  const usb = observe('usb', parseUsbReaders);
  return { version: 'atlas-mac-prerequisite-inspection-v1', observedAt: now().toISOString(),
    scope: 'LOCAL_PREREQUISITES_ONLY', runtime: { architecture, nodeVersion, meetsNode20Requirement: nodeVersion.split('.')[0] === '20' },
    macos, signing, notarytool, stapler, printers, usb,
    unassessed: ['NOTARY_ACCOUNT', 'FINAL_SIGNED_DISTRIBUTION', 'PROTECTED_STATION_KEY', 'HOSTED_ENROLLMENT',
      'READER_FIRMWARE_AND_SUBTYPE', 'TAG_SILICON_AND_PERMANENT_LOCK', 'PRINTER_MEDIA_AND_LABEL_FIT', 'REAL_REPORT_FINISHING'],
    productionReady: false, rfCommandsSent: 0, printJobsSubmitted: 0, privateKeyOperations: 0,
    signingOperations: 0, appleSubmissions: 0, configurationChanges: 0 };
}

export function inspectionCli(args, options) {
  requireValue(args.length === 0, 'MAC_INSPECTION_NO_ARGUMENTS_ALLOWED');
  return inspectMac(options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(inspectionCli(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
