#!/usr/bin/env python3
"""Hardware-free protocol, durable boundary, global exclusion and PTY fault tests."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pty
import subprocess
import sys
import tempfile
import threading
import time
import tty
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "waveshare_bench.py"
spec = importlib.util.spec_from_file_location("waveshare_bench", SOURCE)
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def reply(payload):
    return payload + bench.crc16(payload).to_bytes(2, "little")


class FakeSerial:
    def __init__(self, address=1, firmware=100, pre_on=None, post_on=None, pulse_failure=None, guard=None):
        self.address = address
        self.firmware = firmware
        self.pre_on = pre_on or []
        self.post_on = post_on or []
        self.pulse_failure = pulse_failure
        self.guard = guard
        self.identity = {"path": "/dev/serial/by-id/TEST_FIXTURE_NOT_HARDWARE", "resolvedPath": "/dev/ttyUSB0", "rdev": 123, "serial": "9600/8N1"}
        self.trace = []
        self.requests = []
        self.pulses = 0

    def exchange(self, request):
        self.requests.append(request)
        entry = {"requestHex": request.hex(), "responseHex": "", "elapsedMs": 0, "status": "WRITE_ATTEMPTED"}
        self.trace.append(entry)
        def emit(response):
            entry.update({"responseHex": response.hex(), "status": "FRAME_RECEIVED"})
            return response
        function = request[1]
        register = int.from_bytes(request[2:4], "big")
        if function == 3:
            value = self.address if register == 0x4000 else self.firmware
            return emit(reply(bytes([request[0], 3, 2]) + value.to_bytes(2, "big")))
        if function == 1:
            channels = self.post_on if self.pulses else self.pre_on
            mask = sum(1 << (channel - 1) for channel in channels)
            return emit(reply(bytes([request[0], 1, 4]) + mask.to_bytes(4, "little")))
        if function == 5:
            if self.guard is not None:
                assert self.guard.pulse_consumed(), "Output crossed before durable marker"
            self.pulses += 1
            if self.pulse_failure:
                if isinstance(self.pulse_failure, BaseException):
                    raise self.pulse_failure
                return emit(self.pulse_failure)
            return emit(request)
        raise AssertionError("Unexpected fixture request")


class ProtocolTests(unittest.TestCase):
    def test_official_known_crc_and_flash_vectors(self):
        self.assertEqual(bench.request_for("coils", 1).hex(), "0101000000203dd2")
        # Vendor 700ms example is checked as a CRC vector only, never exposed as an action.
        self.assertEqual(bench.crc16(bytes.fromhex("010502000007")), 0xB08D)
        self.assertEqual(bench.request_for("pulse-unloaded", 1, 1).hex(), "0105020000010db2")
        self.assertEqual(bench.request_for("pulse-unloaded", 1, 32)[2:6], bytes.fromhex("021f0001"))
        self.assertEqual(bench.request_for("address", 1)[:6].hex(), "010340000001")
        self.assertEqual(bench.request_for("firmware", 1)[:6].hex(), "010380000001")

    def test_full_32bit_status_low_bit_is_channel_one(self):
        request = bench.request_for("coils", 1)
        self.assertFalse(any(bench.response_for(request, bytes.fromhex("01010400000000fbd1"))))
        values = bench.response_for(request, reply(bytes.fromhex("01010401000080")))
        self.assertEqual([index + 1 for index, value in enumerate(values) if value], [1, 32])

    def test_broadcast_reserved_invalid_channels_and_generic_commands_rejected(self):
        for address in [0, 248, 255, -1, 1.1, True]:
            with self.subTest(address=address), self.assertRaises(bench.BenchError):
                bench.request_for("coils", address)
        for channel in [0, 33, -1, 1.0, True, None]:
            with self.subTest(channel=channel), self.assertRaises(bench.BenchError):
                bench.request_for("pulse-unloaded", 1, channel)
        for action in ["on", "all-on", "off", "all-off", "toggle", "pulse", "set-address"]:
            with self.subTest(action=action), self.assertRaises(bench.BenchError):
                bench.request_for(action, 1, 1)

    def test_bad_crc_address_function_count_trailing_and_wrong_echo(self):
        request = bench.request_for("coils", 1)
        responses = [b"", bytes.fromhex("01010400000000fbd0"), reply(bytes.fromhex("02010400000000")),
                     reply(bytes.fromhex("01030400000000")), reply(bytes.fromhex("01010300000000")),
                     reply(bytes.fromhex("0101040000000000")), reply(bytes.fromhex("018102"))]
        for response in responses:
            with self.subTest(response=response.hex()), self.assertRaises(bench.BenchError):
                bench.response_for(request, response)
        with self.assertRaisesRegex(bench.BenchError, "does not exactly match"):
            bench.response_for(bench.request_for("pulse-unloaded", 1, 1), bench.request_for("pulse-unloaded", 1, 2))


class DurableBenchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def session(self, guard, **kwargs):
        serial = FakeSerial(guard=guard, **kwargs)
        return serial, bench.WaveshareBench(serial, guard, 1, sleep=lambda seconds: None, host_id="a" * 64)

    def test_inspect_is_read_only_and_does_not_claim_physical_identity_or_off(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            result = session.inspect()
            self.assertEqual([request[1] for request in serial.requests], [3, 3, 1])
            self.assertEqual(result["firmwareRegister"], 100)
            self.assertTrue(result["allRelaysReportedOff"])
            self.assertFalse(result["physicalContactsVerifiedOff"])
            self.assertFalse(guard.pulse_consumed())

    def test_exact_single_pulse_preceded_by_fsynced_marker_and_delayed_off_query(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            real_fsync = os.fsync
            calls = []
            with patch.object(bench.os, "fsync", side_effect=lambda fd: (calls.append(fd), real_fsync(fd))[1]):
                session.sleep = lambda seconds: self.assertEqual((seconds, len(serial.requests)), (0.30, 4))
                result = session.pulse_unloaded(7, 100, bench.confirmation_for(1, 7))
            self.assertGreaterEqual(len(calls), 4)  # Attempt file+directory before output; result file+directory after.
            self.assertEqual(serial.pulses, 1)
            self.assertEqual(serial.requests[3][2:6].hex(), "02060001")
            self.assertEqual([request[1] for request in serial.requests], [3, 3, 1, 5, 1])
            self.assertEqual(result["status"], "ACKNOWLEDGED_AND_CONTROLLER_REPORTS_ALL_OFF")
            self.assertFalse(result["physicalPulseMeasured"])
            self.assertFalse(result["physicalReleaseProven"])
            self.assertTrue(result["externalLoadsDeclaredDisconnected"])
            self.assertFalse(result["externalLoadConnectionVerified"])
            self.assertNotIn("lockConnected", result)
            self.assertTrue(guard.pulse_consumed())
        attempted = (self.directory / "pulse-attempt.json").read_bytes()
        with bench.GlobalBenchGuard(self.directory) as restarted:
            serial, session = self.session(restarted)
            with self.assertRaisesRegex(bench.BenchError, "prior attempt"):
                session.pulse_unloaded(8, 100, bench.confirmation_for(1, 8))
            self.assertEqual(serial.requests, [])
        self.assertEqual((self.directory / "pulse-attempt.json").read_bytes(), attempted)

    def test_wrong_firmware_or_any_preexisting_on_channel_never_energizes(self):
        for kwargs in [{"firmware": 101}, {"pre_on": [1]}, {"pre_on": [32]}]:
            with self.subTest(kwargs=kwargs), bench.GlobalBenchGuard(self.directory) as guard:
                serial, session = self.session(guard, **kwargs)
                with self.assertRaises(bench.BenchError):
                    session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
                self.assertEqual(serial.pulses, 0)
                self.assertFalse(guard.pulse_consumed())

    def test_missing_confirmation_and_address_mismatch_stop_before_pulse(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            with self.assertRaises(bench.BenchError):
                session.pulse_unloaded(1, 100, "yes")
            self.assertEqual(serial.requests, [])
            serial.address = 2
            with self.assertRaises(bench.BenchError):
                session.inspect()
            self.assertEqual(len(serial.requests), 1)

    def test_uncertain_write_never_retries_or_reads_and_survives_process_recreation(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard, pulse_failure=bench.BenchError("SERIAL_TIMEOUT", "late/no response"))
            with self.assertRaises(bench.BenchError):
                session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
            self.assertEqual(serial.pulses, 1)
            self.assertEqual(len(serial.requests), 4)
            with self.assertRaises(bench.BenchError):
                session.inspect()
            self.assertEqual(len(serial.requests), 4)
        child_code = "import importlib.util,sys; s=importlib.util.spec_from_file_location('b',sys.argv[1]); b=importlib.util.module_from_spec(s); s.loader.exec_module(b)\nwith b.GlobalBenchGuard(sys.argv[2]) as g: g.assert_fresh_pulse()"
        completed = subprocess.run([sys.executable, "-c", child_code, str(SOURCE), str(self.directory)], capture_output=True, text=True)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("prior attempt", completed.stderr)
        result = json.loads((self.directory / "pulse-result.json").read_text())
        self.assertEqual(result["status"], "EFFECT_UNKNOWN")
        self.assertEqual(result["errorCode"], "SERIAL_TIMEOUT")

    def test_bad_echo_or_modbus_exception_consumes_pulse_without_followup(self):
        for response in [bench.request_for("pulse-unloaded", 1, 2), reply(bytes.fromhex("018502"))]:
            with self.subTest(response=response.hex()), tempfile.TemporaryDirectory() as directory:
                with bench.GlobalBenchGuard(directory) as guard:
                    serial, session = self.session(guard, pulse_failure=response)
                    with self.assertRaises(bench.BenchError):
                        session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
                    self.assertEqual(len(serial.requests), 4)
                    self.assertTrue(guard.pulse_consumed())

    def test_post_readback_any_on_channel_latches_unknown(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard, post_on=[32])
            with self.assertRaisesRegex(bench.BenchError, "still reports"):
                session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
            self.assertEqual(serial.pulses, 1)
            self.assertTrue(guard.pulse_consumed())
        result = json.loads((self.directory / "pulse-result.json").read_text())
        self.assertEqual(result["channelsReportedOnAfter"], [32])
        self.assertEqual(result["status"], "EFFECT_UNKNOWN")

    def test_partial_or_malformed_attempt_is_not_treated_as_empty(self):
        (self.directory / "pulse-attempt.json").write_bytes(b"{")
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            with self.assertRaises(bench.BenchError):
                session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
            self.assertEqual(serial.requests, [])

    def test_fsync_failure_prevents_pulse_and_retains_consumed_marker(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            with patch.object(bench.os, "fsync", side_effect=OSError("disk failure")), self.assertRaises(OSError):
                session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
            self.assertEqual(serial.pulses, 0)
            self.assertTrue(guard.pulse_consumed())

    def test_killed_process_after_consumption_cannot_replay(self):
        # Model interruption at the pessimistic dispatch boundary, before the
        # parent can know whether a controller write occurred.
        child_code = "import importlib.util,sys,os; s=importlib.util.spec_from_file_location('b',sys.argv[1]); b=importlib.util.module_from_spec(s); s.loader.exec_module(b)\nwith b.GlobalBenchGuard(sys.argv[2]) as g:\n g.consume_pulse({'testFixture': 'interrupted boundary'})\n os._exit(17)"
        completed = subprocess.run([sys.executable, "-c", child_code, str(SOURCE), str(self.directory)], capture_output=True)
        self.assertEqual(completed.returncode, 17)
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            with self.assertRaises(bench.BenchError):
                session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
            self.assertEqual(serial.requests, [])

    def test_result_persistence_failure_does_not_allow_replay(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            original_write = guard.write_new
            def failed_result(name, data):
                if name == "pulse-result.json":
                    raise OSError("result disk failure")
                return original_write(name, data)
            with patch.object(guard, "write_new", side_effect=failed_result), self.assertRaises(OSError):
                session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
            self.assertEqual(serial.pulses, 1)
        with bench.GlobalBenchGuard(self.directory) as restarted:
            serial, session = self.session(restarted)
            with self.assertRaises(bench.BenchError):
                session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
            self.assertEqual(serial.requests, [])

    def test_global_lock_excludes_other_process_for_all_boards_and_ports(self):
        child_code = "import importlib.util,sys; s=importlib.util.spec_from_file_location('b',sys.argv[1]); b=importlib.util.module_from_spec(s); s.loader.exec_module(b)\nwith b.GlobalBenchGuard(sys.argv[2]): print('unexpected acquisition')"
        with bench.GlobalBenchGuard(self.directory):
            completed = subprocess.run([sys.executable, "-c", child_code, str(SOURCE), str(self.directory)], capture_output=True, text=True)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("Another bench process", completed.stderr)
            self.assertNotIn("unexpected acquisition", completed.stdout)
        completed = subprocess.run([sys.executable, "-c", child_code, str(SOURCE), str(self.directory)], capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0)

    def test_guard_rejects_missing_unsafe_or_symlink_state(self):
        with self.assertRaises(bench.BenchError):
            with bench.GlobalBenchGuard(self.directory / "missing"):
                pass
        linked = self.directory / "linked"
        linked.symlink_to(self.directory)
        with self.assertRaises(bench.BenchError):
            with bench.GlobalBenchGuard(linked):
                pass
        self.directory.chmod(0o777)
        with self.assertRaises(bench.BenchError):
            with bench.GlobalBenchGuard(self.directory):
                pass


class ConnectedLockTests(unittest.TestCase):
    setUp = DurableBenchTests.setUp
    tearDown = DurableBenchTests.tearDown
    session = DurableBenchTests.session

    def prepare_unloaded(self, guard):
        serial, session = self.session(guard)
        session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
        return {name: (self.directory / name).read_bytes() for name in ("pulse-attempt.json", "pulse-result.json", "pulse-success.json")}

    def loaded(self, session, channel=1, firmware=100):
        return session.pulse_lock_once(channel, firmware, bench.confirmation_for(1, channel, "pulse-lock-once"))

    def test_same_setup_once_after_durable_unloaded_success(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            original = self.prepare_unloaded(guard)
            serial, session = self.session(guard)
            exchange = serial.exchange
            def checked_exchange(request):
                if request[1] == 5:
                    self.assertTrue(guard.pulse_consumed("pulse-lock-once"))
                    plan = json.loads((self.directory / "lock-pulse-attempt.json").read_text())
                    self.assertEqual(plan["channel"], 1)
                    self.assertEqual(plan["operatorDeclarations"], bench.LOCK_DECLARATIONS)
                return exchange(request)
            serial.exchange = checked_exchange
            result = self.loaded(session)
            self.assertEqual([request[1] for request in serial.requests], [3, 3, 1, 5, 1])
            self.assertEqual(result["status"], bench.SUCCESS)
            self.assertEqual(result["action"], "pulse-lock-once")
            self.assertEqual(result["operatorDeclarations"], bench.LOCK_DECLARATIONS)
            for key in ("physicalPulseMeasured", "physicalReleaseProven", "physicalDoorOpenVerified", "externalLoadConnectionVerified"):
                self.assertIs(result[key], False)
            self.assertFalse(result["externalLoadsDeclaredDisconnected"])
            self.assertTrue(result["priorUnloadedSuccessSha256"])
            self.assertEqual(serial.pulses, 1)
            self.assertTrue(guard.pulse_consumed("pulse-lock-once"))
        for name, raw in original.items():
            self.assertEqual((self.directory / name).read_bytes(), raw)
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            with self.assertRaises(bench.BenchError):
                self.loaded(session)
            self.assertEqual(serial.requests, [])

    def test_missing_failed_uncertain_or_partial_unloaded_never_sends(self):
        cases = (None, bench.BenchError("SERIAL_TIMEOUT", "uncertain"), bench.request_for("pulse-unloaded", 1, 2))
        for failure in cases:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                with bench.GlobalBenchGuard(directory) as guard:
                    if failure:
                        _, session = self.session(guard, pulse_failure=failure)
                        with self.assertRaises(bench.BenchError):
                            session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
                    serial, session = self.session(guard)
                    with self.assertRaises(bench.BenchError):
                        self.loaded(session)
                    self.assertEqual(serial.requests, [])
                    self.assertFalse(guard.pulse_consumed("pulse-lock-once"))

    def test_changed_host_device_address_channel_or_firmware_rejected(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            self.prepare_unloaded(guard)
            cases = ("host", "device", "address", "channel", "firmware", "fixture")
            for change in cases:
                with self.subTest(change=change):
                    serial, session = self.session(guard)
                    channel, firmware = 1, 100
                    if change == "host": session.host_id = "b" * 64
                    if change == "device": serial.identity["path"] += "_different"
                    if change == "address": session.address = 2
                    if change == "channel": channel = 2
                    if change == "firmware": firmware = 101
                    if change == "fixture": serial.identity = {"testFixture": True}
                    with self.assertRaises(bench.BenchError):
                        session.pulse_lock_once(channel, firmware, bench.confirmation_for(session.address, channel, "pulse-lock-once"))
                    self.assertEqual(serial.requests, [])

    def test_noncanonical_altered_or_partial_proof_is_rejected(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            original = self.prepare_unloaded(guard)
            for name in original:
                for raw in (b"{", original[name] + b" ", original[name].replace(b'"schemaVersion": 2', b'"schemaVersion": 1')):
                    with self.subTest(name=name, raw=raw[:20]):
                        (self.directory / name).write_bytes(raw)
                        serial, session = self.session(guard)
                        with self.assertRaises(bench.BenchError): self.loaded(session)
                        self.assertEqual(serial.requests, [])
                        (self.directory / name).write_bytes(original[name])

    def test_consistent_hashes_do_not_make_invalid_status_types_or_trace_valid(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            original = self.prepare_unloaded(guard)
            def bad_trace(result): result["exchanges"][2]["responseHex"] = reply(bytes.fromhex("01010401000000")).hex()
            mutations = [lambda r: r.update(status="EFFECT_UNKNOWN"), lambda r: r.update(acknowledgementMatched=1),
                         lambda r: r.update(physicalPulseMeasured=True), lambda r: r["exchanges"].pop(),
                         lambda r: r["exchanges"][0].update(fixture=True), bad_trace,
                         lambda r: r["exchanges"][3].update(requestHex=bench.request_for("pulse-unloaded", 1, 2).hex())]
            for index, mutation in enumerate(mutations):
                with self.subTest(index=index):
                    result = json.loads(original["pulse-result.json"])
                    mutation(result)
                    raw = bench.canonical(result)
                    (self.directory / "pulse-result.json").write_bytes(raw)
                    seal = json.loads(original["pulse-success.json"])
                    seal["resultSha256"] = bench.sha256(raw)
                    (self.directory / "pulse-success.json").write_bytes(bench.canonical(seal))
                    serial, session = self.session(guard)
                    with self.assertRaises(bench.BenchError): self.loaded(session)
                    self.assertEqual(serial.requests, [])
            for name, raw in original.items(): (self.directory / name).write_bytes(raw)

    def test_fresh_preflight_rejects_on_output_or_firmware_change(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            self.prepare_unloaded(guard)
            for kwargs in ({"pre_on": [32]}, {"firmware": 101}):
                serial, session = self.session(guard, **kwargs)
                with self.assertRaises(bench.BenchError): self.loaded(session)
                self.assertEqual(serial.pulses, 0)
                self.assertFalse(guard.pulse_consumed("pulse-lock-once"))

    def test_loaded_fsync_failure_consumes_without_output(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            self.prepare_unloaded(guard)
            serial, session = self.session(guard)
            with patch.object(bench.os, "fsync", side_effect=OSError("disk failure")), self.assertRaises(OSError):
                self.loaded(session)
            self.assertEqual(serial.pulses, 0)
            self.assertTrue(guard.pulse_consumed("pulse-lock-once"))

    def test_loaded_timeout_never_replays(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            self.prepare_unloaded(guard)
            serial, session = self.session(guard, pulse_failure=bench.BenchError("SERIAL_TIMEOUT", "unknown"))
            with self.assertRaises(bench.BenchError): self.loaded(session)
            self.assertEqual(serial.pulses, 1)
            self.assertEqual(len(serial.requests), 4)
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            with self.assertRaises(bench.BenchError): self.loaded(session)
            self.assertEqual(serial.requests, [])

    def test_loaded_result_failure_and_post_on_state_remain_consumed(self):
        for failure in ("result-write", "post-on"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                with bench.GlobalBenchGuard(directory) as guard:
                    _, unloaded = self.session(guard)
                    unloaded.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
                    serial, session = self.session(guard, post_on=[32] if failure == "post-on" else [])
                    original = guard.write_new
                    def write(name, data):
                        if failure == "result-write" and name == "lock-pulse-result.json": raise OSError("disk failure")
                        return original(name, data)
                    with patch.object(guard, "write_new", side_effect=write), self.assertRaises((OSError, bench.BenchError)):
                        self.loaded(session)
                    self.assertEqual(serial.pulses, 1)
                child_code = "import importlib.util,sys; s=importlib.util.spec_from_file_location('b',sys.argv[1]); b=importlib.util.module_from_spec(s); s.loader.exec_module(b)\nwith b.GlobalBenchGuard(sys.argv[2]) as g: g.assert_fresh_pulse('pulse-lock-once')"
                child = subprocess.run([sys.executable, "-c", child_code, str(SOURCE), directory], capture_output=True, text=True)
                self.assertNotEqual(child.returncode, 0)
                self.assertIn("prior attempt", child.stderr)

    def test_orphan_later_stage_artifact_blocks_fresh_unloaded_pulse(self):
        for suffix in ("attempt", "result", "success"):
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as directory:
                Path(directory, "lock-pulse-" + suffix + ".json").write_bytes(b"{")
                with bench.GlobalBenchGuard(directory) as guard:
                    serial, session = self.session(guard)
                    with self.assertRaises(bench.BenchError):
                        session.pulse_unloaded(1, 100, bench.confirmation_for(1, 1))
                    self.assertEqual(serial.requests, [])

    def test_partial_loaded_marker_and_child_process_crash_block_replay(self):
        with bench.GlobalBenchGuard(self.directory) as guard:
            self.prepare_unloaded(guard)
        child_code = "import importlib.util,sys,os; s=importlib.util.spec_from_file_location('b',sys.argv[1]); b=importlib.util.module_from_spec(s); s.loader.exec_module(b)\nwith b.GlobalBenchGuard(sys.argv[2]) as g:\n g.consume_pulse({'testFixture':'loaded crash'},'pulse-lock-once')\n os._exit(17)"
        child = subprocess.run([sys.executable, "-c", child_code, str(SOURCE), str(self.directory)], capture_output=True)
        self.assertEqual(child.returncode, 17)
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            with self.assertRaises(bench.BenchError): self.loaded(session)
            self.assertEqual(serial.requests, [])
        (self.directory / "lock-pulse-attempt.json").write_bytes(b"{")
        with bench.GlobalBenchGuard(self.directory) as guard:
            serial, session = self.session(guard)
            with self.assertRaises(bench.BenchError): self.loaded(session)
            self.assertEqual(serial.requests, [])


class SerialTransportTests(unittest.TestCase):
    """Real OS byte streams via a pseudoterminal; never a physical serial device."""

    def setUp(self):
        self.master, self.slave = pty.openpty()
        tty.setraw(self.slave)
        os.set_blocking(self.slave, False)
        self.transport = bench.LinuxSerialTransport("PTY_TEST_FIXTURE_ONLY")
        self.transport.fd = self.slave
        self.request = bench.request_for("coils", 1)

    def tearDown(self):
        os.close(self.master)
        self.transport.__exit__(None, None, None)

    def peer(self, response, fragments=False):
        def serve():
            request = os.read(self.master, 256)
            self.assertEqual(request, self.request)
            if response:
                if fragments:
                    os.write(self.master, response[:3])
                    time.sleep(0.005)
                    os.write(self.master, response[3:])
                else:
                    os.write(self.master, response)
        worker = threading.Thread(target=serve)
        worker.start()
        return worker

    def test_fragmented_response_waits_for_complete_frame(self):
        response = bytes.fromhex("01010400000000fbd1")
        worker = self.peer(response, fragments=True)
        self.assertEqual(self.transport.exchange(self.request), response)
        worker.join(timeout=1)
        self.assertFalse(worker.is_alive())

    def test_timeout_faults_transport_with_no_automatic_second_request(self):
        worker = self.peer(None)
        with patch.object(bench, "SERIAL_TIMEOUT_SECONDS", 0.06), self.assertRaisesRegex(bench.BenchError, "bounded attempt"):
            self.transport.exchange(self.request)
        worker.join(timeout=1)
        self.assertTrue(self.transport.faulted)
        with self.assertRaises(bench.BenchError):
            self.transport.exchange(self.request)
        self.assertEqual(len(self.transport.trace), 1)

    def test_stale_or_extra_bytes_fault_before_reuse(self):
        os.write(self.master, b"stale")
        with self.assertRaisesRegex(bench.BenchError, "Stale"):
            self.transport.exchange(self.request)
        self.assertEqual(self.transport.trace[0]["status"], "NOT_SENT")

    def test_valid_frame_plus_trailing_byte_is_not_accepted(self):
        worker = self.peer(bytes.fromhex("01010400000000fbd1ff"))
        with self.assertRaisesRegex(bench.BenchError, "trailing"):
            self.transport.exchange(self.request)
        worker.join(timeout=1)
        self.assertTrue(self.transport.faulted)

    def test_partial_write_is_not_retried(self):
        with patch.object(bench.os, "write", return_value=3) as write:
            with self.assertRaisesRegex(bench.BenchError, "partial"):
                self.transport.exchange(self.request)
            self.assertEqual(write.call_count, 1)
        self.assertTrue(self.transport.faulted)

    def test_transport_rejects_bulk_continuous_and_long_pulse_frames(self):
        requests = [bench.frame(1, 5, 0, 0xFF00), bench.frame(1, 5, 0x00FF, 0xFF00), bench.frame(1, 5, 0x0200, 2)]
        for request in requests:
            with self.subTest(request=request.hex()), self.assertRaises(bench.BenchError):
                self.transport.exchange(request)
        self.assertEqual(self.transport.trace, [])


class EntryPointTests(unittest.TestCase):
    def test_no_port_scan_state_override_duration_or_generic_pulse_action(self):
        for argv in [["pulse"], ["inspect", "--device", "x", "--address", "1", "--state-dir", "x"],
                     ["pulse-unloaded", "--device", "x", "--address", "1", "--duration-ms", "200"]]:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                bench.parser().parse_args(argv)

    def test_non_linux_cli_does_not_open_or_create_state(self):
        with patch.object(bench.sys, "platform", "darwin"), patch.object(bench.os, "open") as opened:
            with contextlib.redirect_stderr(io.StringIO()) as errors:
                self.assertEqual(bench.main(["inspect", "--device", "/dev/serial/by-id/EXAMPLE", "--address", "1"]), 2)
            opened.assert_not_called()
            self.assertEqual(json.loads(errors.getvalue())["errorCode"], "LINUX_REQUIRED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
