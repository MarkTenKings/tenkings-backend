#!/usr/bin/env python3
"""Isolated Linux Waveshare 32CH bench tool. Never imported by the Vault service.

Real serial I/O, not a simulated ControllerAdapter. One unloaded nominal 100 ms
flash-on may precede one separately declared, same-setup single-lock test. No reset,
retry, address scan, configuration write, ordinary ON, toggle or bulk write API.
"""

import argparse
import datetime
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import select
import stat
import sys
import termios
import time


STATE_DIRECTORY = Path("/var/lib/ten-kings-vault-bench")
PROTOCOL_SOURCE = "https://www.waveshare.com/wiki/Modbus_RTU_Relay_32CH"
NOMINAL_PULSE_MS = 100
READBACK_DELAY_SECONDS = 0.30
SERIAL_TIMEOUT_SECONDS = 1.0
RTU_IDLE_SECONDS = 0.01  # More than 3.5 characters at fixed 9600/8N1.
SUCCESS = "ACKNOWLEDGED_AND_CONTROLLER_REPORTS_ALL_OFF"
IDENTITY_SCOPE = "Address/version registers only; physical board model and unique identity are not discoverable"
LOCK_DECLARATIONS = {"soleAccessibleSecuredLock": True, "receivedPolarityPigtailFuseSuppressionWiringChecked": True,
                     "samePhysicalSetup": True, "supplyDisconnectReady": True}


class BenchError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def fail(code, message):
    raise BenchError(code, message)


def integer(value, minimum, maximum, name):
    if type(value) is not int or not minimum <= value <= maximum:
        fail("INVALID_ARGUMENT", "%s must be an integer from %d to %d" % (name, minimum, maximum))
    return value


def crc16(data):
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if crc & 1 else 0)
    return crc


def frame(address, function, register, value):
    integer(address, 1, 247, "address")  # Exclude broadcast and reserved addresses.
    payload = bytes([address, function]) + register.to_bytes(2, "big") + value.to_bytes(2, "big")
    return payload + crc16(payload).to_bytes(2, "little")


def request_for(action, address, channel=None):
    if action == "address":
        return frame(address, 3, 0x4000, 1)
    if action == "firmware":
        return frame(address, 3, 0x8000, 1)
    if action == "coils":
        return frame(address, 1, 0, 32)
    if action == "pulse-unloaded":
        integer(channel, 1, 32, "channel")
        return frame(address, 5, 0x0200 + channel - 1, 1)
    fail("UNSUPPORTED_COMMAND", "Only identity/status reads and the fixed 100 ms flash-on frame are supported")


def response_for(request, response):
    if len(response) < 5 or crc16(response[:-2]) != int.from_bytes(response[-2:], "little"):
        fail("RESPONSE_CRC_OR_LENGTH", "Response is missing, truncated, or has an invalid CRC")
    if response[0] != request[0]:
        fail("RESPONSE_ADDRESS", "Response address differs from the explicitly selected board")
    if response[1] == (request[1] | 0x80) and len(response) == 5:
        fail("MODBUS_EXCEPTION", "Board returned Modbus exception %d; do not retry" % response[2])
    if response[1] != request[1]:
        fail("RESPONSE_FUNCTION", "Unexpected response function")
    if request[1] == 5:
        if response != request:
            fail("RESPONSE_ECHO", "Flash-on acknowledgement does not exactly match the request")
        return None
    length = 7 if request[1] == 3 else 9
    count = 2 if request[1] == 3 else 4
    if len(response) != length or response[2] != count:
        fail("RESPONSE_LENGTH", "Unexpected response size or byte count")
    if request[1] == 3:
        return int.from_bytes(response[3:5], "big")
    return [bool(response[3 + bit // 8] & (1 << (bit % 8))) for bit in range(32)]


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def canonical(data):
    return (json.dumps(data, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def host_identity():
    machine_id = Path("/etc/machine-id").read_text().strip()
    if len(machine_id) != 32 or any(character not in "0123456789abcdef" for character in machine_id):
        fail("HOST_IDENTITY_INVALID", "A stable Linux machine-id is required; no fallback identity is allowed")
    return sha256(machine_id.encode())


def pulse_prefix(action):
    if action not in ("pulse-unloaded", "pulse-lock-once"):
        fail("UNSUPPORTED_COMMAND", "Unknown bench pulse action")
    return "pulse" if action == "pulse-unloaded" else "lock-pulse"


class GlobalBenchGuard:
    """One host-wide bench owner, across every address, serial port and process.

    The public CLI always uses STATE_DIRECTORY. The injected path exists only for
    hardware-free tests. State is never deleted, overwritten or auto-recovered.
    """

    def __init__(self, directory=STATE_DIRECTORY):
        self.directory = Path(directory)
        self.fd = None
        self.held = False

    def __enter__(self):
        try:
            info = self.directory.lstat()
        except FileNotFoundError:
            fail("STATE_DIRECTORY_MISSING", "Prepare /var/lib/ten-kings-vault-bench for the dedicated local operator first")
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            fail("STATE_DIRECTORY_UNSAFE", "Bench state must be a real directory owned by this user with mode 0700")
        try:
            self.fd = os.open(str(self.directory / "serial.lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            lock_info = os.fstat(self.fd)
            if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_nlink != 1 or lock_info.st_uid != os.geteuid():
                fail("LOCK_UNSAFE", "Bench lock file is not a private regular file")
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.held = True
            return self
        except (BlockingIOError, PermissionError):
            self.__exit__(None, None, None)
            fail("BENCH_BUSY", "Another bench process owns the global lock; no hardware command was attempted")
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        self.held = False
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def require_held(self):
        if not self.held:
            fail("GLOBAL_LOCK_REQUIRED", "The complete bench session requires the global host lock")

    def pulse_consumed(self, action="pulse-unloaded"):
        self.require_held()
        # Any existing object, including an incomplete or malformed file, blocks.
        prefixes = ("pulse", "lock-pulse") if action == "pulse-unloaded" else (pulse_prefix(action),)
        return any(os.path.lexists(str(self.directory / (prefix + suffix))) for prefix in prefixes for suffix in ("-attempt.json", "-result.json", "-success.json"))

    def assert_fresh_pulse(self, action="pulse-unloaded"):
        if self.pulse_consumed(action):
            fail("PULSE_ALREADY_CONSUMED", "Preserve pulse-attempt.json and review the prior attempt; this tool has no retry/reset command")

    def write_new(self, name, data):
        self.require_held()
        payload = canonical(data)
        fd = os.open(str(self.directory / name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
            directory_fd = os.open(str(self.directory), os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except BaseException:
            # The file is deliberately retained even if persistence was partial.
            raise

    def consume_pulse(self, plan, action="pulse-unloaded"):
        self.assert_fresh_pulse(action)
        self.write_new(pulse_prefix(action) + "-attempt.json", plan)

    def read_evidence(self, name):
        self.require_held()
        fd = os.open(str(self.directory / name), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_size > 32768:
                fail("UNLOADED_EVIDENCE_INVALID", "Evidence must be bounded, private, unlinked regular files")
            raw = source.read(32769)
        try:
            value = json.loads(raw)
            if type(value) is not dict or raw != canonical(value):
                raise ValueError("noncanonical evidence")
        except (ValueError, TypeError, UnicodeError, RecursionError):
            fail("UNLOADED_EVIDENCE_INVALID", "Malformed or noncanonical unloaded diagnostic evidence")
        return value, sha256(raw)


class LinuxSerialTransport:
    def __init__(self, device):
        self.device = device
        self.fd = None
        self.faulted = False
        self.trace = []

    def __enter__(self):
        if sys.platform != "linux":
            fail("LINUX_REQUIRED", "Physical serial access is supported only on Linux; no hardware was opened")
        path = Path(self.device)
        if path.parent != Path("/dev/serial/by-id") or not path.is_symlink():
            fail("STABLE_DEVICE_PATH_REQUIRED", "Select the exact adapter under /dev/serial/by-id; no scan or ttyUSB-number fallback")
        target = path.resolve(strict=True)
        info = target.stat()
        if not stat.S_ISCHR(info.st_mode):
            fail("SERIAL_DEVICE_INVALID", "Selected path is not a character device")
        self.fd = os.open(str(target), os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK | os.O_NOFOLLOW)
        try:
            opened = os.fstat(self.fd)
            if (opened.st_dev, opened.st_ino, opened.st_rdev) != (info.st_dev, info.st_ino, info.st_rdev):
                fail("SERIAL_DEVICE_CHANGED", "Serial device changed while it was being opened")
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.ioctl(self.fd, termios.TIOCEXCL)  # Reject later opens by other unprivileged tools.
            attributes = termios.tcgetattr(self.fd)
            attributes[0:6] = [0, 0, termios.CS8 | termios.CREAD | termios.CLOCAL, 0, termios.B9600, termios.B9600]
            attributes[6][termios.VMIN] = 0
            attributes[6][termios.VTIME] = 0
            termios.tcsetattr(self.fd, termios.TCSANOW, attributes)
            self.identity = {"path": str(path), "resolvedPath": str(target), "rdev": opened.st_rdev, "serial": "9600/8N1"}
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def exchange(self, request):
        if self.faulted or self.fd is None:
            fail("TRANSPORT_UNAVAILABLE", "A failed or closed serial session cannot be reused")
        # Allowlist complete requests here as well as at the protocol layer.
        allowed = [request_for(action, request[0]) for action in ("address", "firmware", "coils")]
        allowed.extend(request_for("pulse-unloaded", request[0], channel) for channel in range(1, 33))
        if request not in allowed:
            fail("TRANSPORT_COMMAND_BLOCKED", "This transport does not provide arbitrary Modbus output")
        started = time.monotonic()
        received = bytearray()
        entry = {"requestHex": request.hex(), "responseHex": "", "status": "NOT_SENT"}
        self.trace.append(entry)
        try:
            if select.select([self.fd], [], [], RTU_IDLE_SECONDS)[0]:
                fail("UNEXPECTED_SERIAL_INPUT", "Stale or unsolicited bytes exist; do not flush them and continue")
            entry["status"] = "WRITE_ATTEMPTED"
            written = os.write(self.fd, request)
            if written != len(request):
                fail("PARTIAL_SERIAL_WRITE", "The request may be partial; no remaining bytes or retry will be sent")
            expected = {1: 9, 3: 7, 5: 8}[request[1]]
            deadline = started + SERIAL_TIMEOUT_SECONDS
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    fail("SERIAL_TIMEOUT", "Response was not complete within one bounded attempt")
                wait = min(remaining, RTU_IDLE_SECONDS) if len(received) >= expected else remaining
                readable = select.select([self.fd], [], [], wait)[0]
                if not readable:
                    if len(received) == expected:
                        break
                    fail("SERIAL_TIMEOUT", "Response was not complete within one bounded attempt")
                chunk = os.read(self.fd, 257 - len(received))
                if not chunk:
                    fail("SERIAL_DISCONNECTED", "Serial peer disconnected during the attempt")
                received.extend(chunk)
                if len(received) >= 2 and received[1] & 0x80:
                    expected = 5
                if len(received) > expected:
                    fail("EXTRA_SERIAL_BYTES", "Response contains unexpected trailing bytes; no subsequent command is allowed")
            entry["status"] = "FRAME_RECEIVED"
            return bytes(received)
        except BaseException:
            self.faulted = True
            raise
        finally:
            entry["responseHex"] = received.hex()
            entry["elapsedMs"] = round((time.monotonic() - started) * 1000, 3)


class WaveshareBench:
    def __init__(self, transport, guard, address, sleep=time.sleep, host_id=None):
        self.address = integer(address, 1, 247, "address")
        self.transport = transport
        self.guard = guard
        self.sleep = sleep
        self.faulted = False
        self.host_id = host_id if host_id is not None else host_identity()

    def request(self, action, channel=None):
        self.guard.require_held()
        if self.faulted:
            fail("BENCH_FAULTED", "This failed session cannot send another request")
        try:
            request = request_for(action, self.address, channel)
            return response_for(request, self.transport.exchange(request))
        except BaseException:
            self.faulted = True
            raise

    def inspect(self):
        reported_address = self.request("address")
        if reported_address != self.address:
            self.faulted = True
            fail("DEVICE_ADDRESS_MISMATCH", "Configured address differs from the board address register")
        firmware = self.request("firmware")
        coils = self.request("coils")
        return {"address": self.address, "firmwareRegister": firmware, "firmwareDisplay": "V%.2f" % (firmware / 100),
                "channelsReportedOn": [index + 1 for index, on in enumerate(coils) if on],
                "allRelaysReportedOff": not any(coils), "physicalContactsVerifiedOff": False,
                "pulseAttemptConsumed": self.guard.pulse_consumed(), "protocolSource": PROTOCOL_SOURCE,
                "identityScope": IDENTITY_SCOPE}

    def pulse_unloaded(self, channel, expected_firmware, confirmation):
        return self.pulse("pulse-unloaded", channel, expected_firmware, confirmation)

    def pulse_lock_once(self, channel, expected_firmware, confirmation):
        return self.pulse("pulse-lock-once", channel, expected_firmware, confirmation)

    def validate_unloaded_evidence(self, channel, firmware):
        """Strictly bind three create-only records; never trust a success filename.

        Hashes catch alteration/inconsistency, not malicious rewriting by the
        privileged state owner, and do not attest that the physical wiring is safe.
        """
        try:
            plan, plan_sha = self.guard.read_evidence("pulse-attempt.json")
            result, result_sha = self.guard.read_evidence("pulse-result.json")
            seal, seal_sha = self.guard.read_evidence("pulse-success.json")
            expected_seal = {"schemaVersion": 2, "action": "pulse-unloaded", "hostId": self.host_id,
                             "attemptSha256": plan_sha, "resultSha256": result_sha}
            if canonical(seal) != canonical(expected_seal):
                raise ValueError("artifact digest or host mismatch")
            device = self.transport.identity
            if set(device) != {"path", "resolvedPath", "rdev", "serial"} or device["serial"] != "9600/8N1":
                raise ValueError("unknown or fixture device identity")
            if type(device["path"]) is not str or Path(device["path"]).parent != Path("/dev/serial/by-id"):
                raise ValueError("adapter identity is not stable")
            if type(device["resolvedPath"]) is not str or not device["resolvedPath"].startswith("/dev/"):
                raise ValueError("invalid device path")
            integer(device["rdev"], 0, 2**64 - 1, "device rdev")
            before = {"address": self.address, "firmwareRegister": firmware, "firmwareDisplay": "V%.2f" % (firmware / 100),
                      "channelsReportedOn": [], "allRelaysReportedOff": True, "physicalContactsVerifiedOff": False,
                      "pulseAttemptConsumed": False, "protocolSource": PROTOCOL_SOURCE, "identityScope": IDENTITY_SCOPE}
            expected_plan = {"schemaVersion": 2, "createdAt": plan.get("createdAt"), "status": "ATTEMPT_CONSUMED_BEFORE_WRITE",
                             "action": "pulse-unloaded", "loadPolicy": "ALL_EXTERNAL_LOADS_DISCONNECTED",
                             "address": self.address, "channel": channel, "expectedFirmwareRegister": firmware,
                             "nominalPulseMs": 100, "requestHex": request_for("pulse-unloaded", self.address, channel).hex(),
                             "device": device, "before": before, "hostId": self.host_id,
                             "operatorDeclarations": {"allExternalLoadsDisconnected": True}, "priorUnloadedSuccessSha256": None}
            if canonical(plan) != canonical(expected_plan):
                raise ValueError("unloaded plan identity/type/schema mismatch")
            expected_result = {"schemaVersion": 2, "action": "pulse-unloaded", "address": self.address, "channel": channel,
                               "nominalPulseMs": 100, "attemptConsumed": True, "physicalPulseMeasured": False,
                               "externalLoadsDeclaredDisconnected": True, "externalLoadConnectionVerified": False,
                               "physicalReleaseProven": False, "physicalDoorOpenVerified": False, "status": SUCCESS,
                               "acknowledgementMatched": True, "channelsReportedOnAfter": [], "completedAt": result.get("completedAt"),
                               "exchanges": result.get("exchanges"), "attemptSha256": plan_sha, "hostId": self.host_id,
                               "operatorDeclarations": {"allExternalLoadsDisconnected": True}, "priorUnloadedSuccessSha256": None}
            if canonical(result) != canonical(expected_result):
                raise ValueError("unloaded result identity/type/schema/status mismatch")
            started = datetime.datetime.fromisoformat(plan["createdAt"])
            completed = datetime.datetime.fromisoformat(result["completedAt"])
            now = datetime.datetime.now(datetime.timezone.utc)
            if started.tzinfo is None or completed.tzinfo is None or not started <= completed <= now:
                raise ValueError("invalid evidence chronology")
            exchanges = result["exchanges"]
            actions = ("address", "firmware", "coils", "pulse-unloaded", "coils")
            if type(exchanges) is not list or len(exchanges) != len(actions):
                raise ValueError("incomplete or additional transactions")
            for action, exchange in zip(actions, exchanges):
                if type(exchange) is not dict or set(exchange) != {"requestHex", "responseHex", "elapsedMs", "status"}:
                    raise ValueError("fixture or malformed transaction")
                duration = exchange["elapsedMs"]
                if type(duration) not in (int, float) or not math.isfinite(duration) or not 0 <= duration <= 2000 or exchange["status"] != "FRAME_RECEIVED":
                    raise ValueError("transaction did not complete")
                request = request_for(action, self.address, channel)
                if exchange["requestHex"] != request.hex() or type(exchange["responseHex"]) is not str:
                    raise ValueError("transaction address or command mismatch")
                response = bytes.fromhex(exchange["responseHex"])
                if response.hex() != exchange["responseHex"]:
                    raise ValueError("noncanonical response")
                observed = response_for(request, response)
                if (action == "address" and observed != self.address) or (action == "firmware" and observed != firmware) or (action == "coils" and any(observed)):
                    raise ValueError("identity or all-off response mismatch")
            return seal_sha
        except (OSError, ValueError, TypeError, KeyError, OverflowError, BenchError):
            fail("UNLOADED_EVIDENCE_INVALID", "Prior unloaded evidence is missing, uncertain, altered or does not match this exact host/device/address/channel/firmware")

    def pulse(self, action, channel, expected_firmware, confirmation):
        integer(channel, 1, 32, "channel")
        integer(expected_firmware, 0, 65535, "expected firmware")
        expected = confirmation_for(self.address, channel, action)
        if confirmation != expected:
            fail("CONFIRMATION_REQUIRED", "Exact bench setup declaration is required: " + expected)
        self.guard.assert_fresh_pulse(action)
        loaded = action == "pulse-lock-once"
        prior_sha = self.validate_unloaded_evidence(channel, expected_firmware) if loaded else None
        trace_start = len(self.transport.trace)
        before = self.inspect()
        if before["firmwareRegister"] != expected_firmware:
            fail("FIRMWARE_MISMATCH", "Firmware does not match the separately observed inspect result")
        if not before["allRelaysReportedOff"]:
            fail("RELAYS_NOT_OFF", "One or more outputs report ON; no flash-on will be sent")
        declarations = dict(LOCK_DECLARATIONS) if loaded else {"allExternalLoadsDisconnected": True}
        plan = {"schemaVersion": 2, "createdAt": utc_now(), "status": "ATTEMPT_CONSUMED_BEFORE_WRITE",
                "action": action, "loadPolicy": "SOLE_SUPERVISED_SECURED_ACCESSIBLE_LOCK" if loaded else "ALL_EXTERNAL_LOADS_DISCONNECTED",
                "address": self.address, "channel": channel, "expectedFirmwareRegister": expected_firmware,
                "nominalPulseMs": NOMINAL_PULSE_MS, "requestHex": request_for("pulse-unloaded", self.address, channel).hex(),
                "device": self.transport.identity, "before": before, "hostId": self.host_id,
                "operatorDeclarations": declarations, "priorUnloadedSuccessSha256": prior_sha}
        self.guard.consume_pulse(plan, action)  # fsync file AND directory before any energizing write.
        result = {"schemaVersion": 2, "action": action, "address": self.address, "channel": channel,
                  "nominalPulseMs": NOMINAL_PULSE_MS, "attemptConsumed": True, "physicalPulseMeasured": False,
                  "externalLoadsDeclaredDisconnected": not loaded, "externalLoadConnectionVerified": False,
                  "physicalReleaseProven": False, "physicalDoorOpenVerified": False, "status": "EFFECT_UNKNOWN",
                  "attemptSha256": sha256(canonical(plan)), "hostId": self.host_id,
                  "operatorDeclarations": declarations, "priorUnloadedSuccessSha256": prior_sha}
        try:
            self.request("pulse-unloaded", channel)
            result["acknowledgementMatched"] = True
            self.sleep(READBACK_DELAY_SECONDS)
            coils = self.request("coils")
            result["channelsReportedOnAfter"] = [index + 1 for index, on in enumerate(coils) if on]
            if any(coils):
                fail("POST_PULSE_RELAYS_NOT_OFF", "Controller still reports an output ON; stop and inspect the bench")
            result["status"] = SUCCESS
        except BaseException as error:
            self.faulted = True
            result["errorCode"] = error.code if isinstance(error, BenchError) else "INTERRUPTED_OR_IO_FAILED"
            raise
        finally:
            result["completedAt"] = utc_now()
            result["exchanges"] = self.transport.trace[trace_start:]
            self.guard.write_new(pulse_prefix(action) + "-result.json", result)
        self.guard.write_new(pulse_prefix(action) + "-success.json", {"schemaVersion": 2, "action": action,
                             "hostId": self.host_id, "attemptSha256": sha256(canonical(plan)), "resultSha256": sha256(canonical(result))})
        return result


def confirmation_for(address, channel, action="pulse-unloaded"):
    if action == "pulse-lock-once":
        return "ONE SECURED ACCESSIBLE LOCK; RECEIVED POLARITY PIGTAIL F1 D1 WIRING CHECKED; SAME SETUP; DISCONNECT READY; PULSE ADDRESS %d CHANNEL %d ONCE 100MS" % (address, channel)
    pulse_prefix(action)
    return "ALL LOADS DISCONNECTED; PULSE ADDRESS %d CHANNEL %d ONCE 100MS" % (address, channel)


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="action", required=True)
    for action in ("inspect", "pulse-unloaded", "pulse-lock-once"):
        command = commands.add_parser(action)
        command.add_argument("--device", required=True, help="Exact /dev/serial/by-id/ adapter path")
        command.add_argument("--address", type=int, required=True, help="Explicit unicast address 1-247; no scanning")
        if action != "inspect":
            command.add_argument("--channel", type=int, required=True)
            command.add_argument("--expected-firmware", type=int, required=True, help="Exact integer from inspect")
            command.add_argument("--confirm", required=True)
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        integer(args.address, 1, 247, "address")
        if sys.platform != "linux":
            fail("LINUX_REQUIRED", "Physical bench CLI requires Linux; no hardware was opened")
        with GlobalBenchGuard() as guard:
            if args.action != "inspect":
                integer(args.channel, 1, 32, "channel")
                integer(args.expected_firmware, 0, 65535, "expected firmware")
                if args.confirm != confirmation_for(args.address, args.channel, args.action):
                    fail("CONFIRMATION_REQUIRED", "The exact bench setup declaration is missing")
                guard.assert_fresh_pulse(args.action)
            with LinuxSerialTransport(args.device) as transport:
                bench = WaveshareBench(transport, guard, args.address)
                result = bench.inspect() if args.action == "inspect" else bench.pulse(args.action, args.channel, args.expected_firmware, args.confirm)
                result["transport"] = "REAL_LINUX_SERIAL_BENCH"
                result["device"] = transport.identity
                result["exchanges"] = transport.trace
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except (BenchError, OSError, KeyboardInterrupt) as error:
        print(json.dumps({"status": "STOPPED", "errorCode": error.code if isinstance(error, BenchError) else "IO_OR_INTERRUPT",
                          "message": str(error), "automaticRetry": False, "hardwareStateVerified": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
