"""Synthetic collector tests: no target, daemon, provider, or executable calls."""

import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "inspect-decoder-target.py"
SPEC = importlib.util.spec_from_file_location("inspect_decoder_target", SCRIPT)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


def version_body(**changes):
    data = {
        "Version": "27.5.1", "ApiVersion": "1.47", "MinAPIVersion": "1.24",
        "Os": "linux", "Arch": "amd64",
        "Components": [
            {"Name": "containerd", "Version": "1.7.25", "Details": {"secret": "DO_NOT_EMIT"}},
            {"Name": "runc", "Version": "1.2.4", "Details": {"secret": "DO_NOT_EMIT"}},
        ],
        "Config": {"Env": ["DO_NOT_EMIT"]}, "unknown": "DO_NOT_EMIT",
    }
    data.update(changes)
    return json.dumps(data).encode()


def http(body, headers=None):
    fields = headers if headers is not None else [b"Content-Length: " + str(len(body)).encode()]
    return b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" + b"\r\n".join(fields) + b"\r\n\r\n" + body


class CollectorTests(unittest.TestCase):
    def assert_status(self, status, action):
        self.assertEqual(collector.capture(action), {"status": status})

    def test_default_reads_only_allowlist_and_no_socket(self):
        files = {
            "/etc/os-release": 'ID=synthetic\nVERSION_ID="0.1"\nSECRET="DO_NOT_EMIT"\n',
            "/proc/sys/kernel/random/boot_id": "12345678-1234-1234-1234-123456789abc\n",
            "/proc/%d/mountinfo" % os.getpid(): "26 23 0:23 / /sys/fs/cgroup rw,nosuid,nodev,noexec - cgroup2 cgroup rw\n",
            "/sys/fs/cgroup/cgroup.controllers": "cpu memory pids\n",
            "/sys/fs/cgroup/cgroup.type": "domain\n",
            "/sys/module/apparmor/parameters/enabled": "Y\n",
            "/sys/kernel/security/lsm": "lockdown,capability,apparmor\n",
            "/proc/1/comm": "systemd\n",
        }
        with patch.object(collector, "read_file", side_effect=files.__getitem__) as read, \
             patch.object(collector.os, "uname", return_value=SimpleNamespace(machine="synthetic64", release="0.1-test")), \
             patch.object(collector.os, "confstr", return_value="glibc 0.1"), \
             patch.object(collector, "run_systemd_version", return_value="systemd 999 (synthetic)\n+PAM\n"), \
             patch.object(collector.socket, "socket", side_effect=AssertionError("socket forbidden")), \
             patch.object(collector.subprocess, "Popen", side_effect=AssertionError("execution forbidden")):
            result = collector.report(collector.collect_facts(), "COMPLETED")
        self.assertEqual({call.args[0] for call in read.call_args_list}, set(files))
        self.assertEqual(result["status"], "UNVERIFIED")
        self.assertFalse(result["runtimeQualified"])
        self.assertFalse(result["executionAllowed"])
        self.assertEqual(result["facts"]["machine"]["value"], "synthetic64")
        self.assertEqual(result["missingFacts"], ["dockerServer", "containerd", "runc"])
        self.assertEqual(result["facts"]["dockerServer"]["status"], "NOT_REQUESTED")
        self.assertNotIn("DO_NOT_EMIT", json.dumps(result))

    def test_failures_are_value_free_and_never_default_to_target_fixture(self):
        with patch.object(collector, "read_file", side_effect=PermissionError("DO_NOT_EMIT")), \
             patch.object(collector.os, "uname", side_effect=OSError("DO_NOT_EMIT")), \
             patch.object(collector.os, "confstr", side_effect=ValueError("DO_NOT_EMIT")), \
             patch.object(collector, "run_systemd_version", side_effect=FileNotFoundError("DO_NOT_EMIT")), \
             patch.object(collector, "read_docker_version", side_effect=TimeoutError("DO_NOT_EMIT")):
            result = collector.report(collector.collect_facts("/run/docker.sock"), "COMPLETED")
        self.assertEqual(set(result["missingFacts"]), set(collector.FACT_SOURCES))
        self.assertEqual(result["facts"]["dockerServer"]["status"], "TIMEOUT")
        self.assertEqual(result["facts"]["systemdVersion"]["status"], "MISSING")
        self.assertNotIn("DO_NOT_EMIT", json.dumps(result))
        self.assertTrue(all("value" not in fact for fact in result["facts"].values()))

    def test_file_bounds_symlinks_and_path_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "data"
            target.write_bytes(b"abcd")
            # macOS /var may be an alias; use the real synthetic test directory.
            target = target.resolve()
            self.assertEqual(collector._read_fixed_path(str(target), 4), b"abcd")
            self.assert_status("LIMIT_EXCEEDED", lambda: collector._read_fixed_path(str(target), 3))
            link = target.with_name("alias")
            link.symlink_to(target)
            self.assert_status("UNAVAILABLE", lambda: collector._read_fixed_path(str(link), 4))
        with patch.object(collector, "_read_fixed_path", side_effect=AssertionError("must refuse before open")):
            self.assert_status("REFUSED_PATH", lambda: collector.read_file("/root/.ssh/id_rsa"))
            self.assert_status("REFUSED_PATH", lambda: collector.read_file("/proc/self/environ"))

    def test_linux_parsers_refuse_ambiguity_and_project_only_expected_mount(self):
        self.assert_status("MALFORMED", lambda: collector.parse_os_release("ID=a\nID=b\nVERSION_ID=1"))
        self.assert_status("MALFORMED", lambda: collector.parse_boot_id("unknown"))
        self.assert_status("MALFORMED", lambda: collector.parse_tokens("cpu cpu"))
        self.assert_status("MALFORMED", lambda: collector.parse_apparmor("enforcing"))
        self.assert_status("MALFORMED", lambda: collector.parse_systemd_version("DO_NOT_EMIT"))
        self.assertEqual(collector.parse_apparmor("N\n"), False)
        self.assertEqual(collector.parse_tokens("\n"), [])
        mounts = "26 23 0:23 /private/DO_NOT_EMIT /sys/fs/cgroup rw,nodev - cgroup2 cgroup rw\n"
        projected = collector.parse_cgroup_mount(mounts)
        self.assertFalse(projected["rootIsFilesystemRoot"])
        self.assertNotIn("DO_NOT_EMIT", json.dumps(projected))
        self.assert_status("MALFORMED", lambda: collector.parse_cgroup_mount(mounts * 2))
        self.assert_status("MISSING", lambda: collector.parse_cgroup_mount("26 23 0:23 / /other rw - cgroup2 cgroup rw\n"))

    def test_docker_json_projects_only_reported_versions(self):
        result = collector.parse_docker_version(version_body())
        self.assertEqual(result["containerd"], {"status": "OBSERVED", "value": "1.7.25"})
        self.assertEqual(result["runc"], {"status": "OBSERVED", "value": "1.2.4"})
        self.assertNotIn("DO_NOT_EMIT", json.dumps(result))
        missing = collector.parse_docker_version(version_body(Components=[]))
        self.assertEqual(missing["containerd"], {"status": "MISSING"})
        self.assertEqual(missing["runc"], {"status": "MISSING"})
        self.assert_status("MALFORMED", lambda: collector.parse_docker_version(b'{"Version":"a","Version":"b"}'))
        self.assert_status("MALFORMED", lambda: collector.parse_docker_version(version_body(Version="\nDO_NOT_EMIT")))
        self.assert_status("MALFORMED", lambda: collector.parse_docker_version(version_body(Components=[{"Name": "runc", "Version": "1"}] * 2)))
        self.assert_status("LIMIT_EXCEEDED", lambda: collector.parse_docker_version(b" " * (collector.BODY_LIMIT + 1)))

    def test_http_content_length_chunked_and_no_extra_messages(self):
        body = version_body()
        self.assertEqual(collector.parse_version_http(http(body)), body)
        chunks = b"%x\r\n" % len(body) + body + b"\r\n0\r\n\r\n"
        self.assertEqual(collector.parse_version_http(http(chunks, [b"Transfer-Encoding: chunked"])), body)
        self.assert_status("MALFORMED", lambda: collector.parse_version_http(http(body, [b"Content-Length: 1"])))
        self.assert_status("MALFORMED", lambda: collector.parse_version_http(http(body, [b"Content-Length: 1", b"Content-Length: 1"])))
        self.assert_status("MALFORMED", lambda: collector.parse_version_http(http(chunks, [b"Transfer-Encoding: chunked", b"Content-Length: 1"])))
        self.assert_status("MALFORMED", lambda: collector.parse_version_http(http(chunks + b"extra", [b"Transfer-Encoding: chunked"])))
        self.assert_status("HTTP_REFUSED", lambda: collector.parse_version_http(http(body).replace(b"200 OK", b"302 Found")))
        self.assert_status("LIMIT_EXCEEDED", lambda: collector.parse_version_http(b"x" * (collector.WIRE_LIMIT + 1)))

    def test_optional_socket_is_unix_and_exactly_one_version_read(self):
        response = http(version_body())
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.recv.side_effect = [response[:50], response[50:], b""]
        with patch.object(collector.socket, "socket", return_value=connection) as constructor:
            body = collector.read_docker_version("/run/docker.sock")
        constructor.assert_called_once_with(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.connect.assert_called_once_with("/run/docker.sock")
        connection.sendall.assert_called_once_with(b"GET /version HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n\r\n")
        self.assertEqual(body, version_body())
        self.assertTrue(all(0 < call.args[0] <= collector.SOCKET_TIMEOUT for call in connection.settimeout.call_args_list))
        with patch.object(collector.socket, "socket", side_effect=AssertionError("must refuse before socket")):
            self.assert_status("REFUSED_PATH", lambda: collector.read_docker_version("tcp://127.0.0.1:2375"))
            self.assert_status("REFUSED_PATH", lambda: collector.read_docker_version("/tmp/arbitrary.sock"))

    def test_socket_timeout_and_header_budget(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.recv.side_effect = TimeoutError("DO_NOT_EMIT")
        with patch.object(collector.socket, "socket", return_value=connection):
            self.assert_status("TIMEOUT", lambda: collector.read_docker_version("/run/docker.sock"))
        connection.recv.side_effect = [b"x" * 4096] * 3
        with patch.object(collector.socket, "socket", return_value=connection):
            self.assert_status("LIMIT_EXCEEDED", lambda: collector.read_docker_version("/run/docker.sock"))

    def test_systemd_command_is_fixed_and_output_bounded_without_spawning(self):
        read_fd, write_fd = os.pipe()
        os.write(write_fd, b"systemd 999 (synthetic)\n")
        os.close(write_fd)
        process = MagicMock()
        process.stdout = os.fdopen(read_fd, "rb")
        process.wait.return_value = 0
        process.poll.return_value = 0
        with patch.object(collector.subprocess, "Popen", return_value=process) as spawn:
            self.assertEqual(collector.run_systemd_version(), "systemd 999 (synthetic)\n")
        args, kwargs = spawn.call_args
        self.assertEqual(args, (collector.SYSTEMD_COMMAND,))
        self.assertEqual(kwargs["env"], {"LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"})
        self.assertFalse(kwargs["shell"])
        self.assertEqual(kwargs["stderr"], collector.subprocess.DEVNULL)
        process.kill.assert_not_called()

        process = MagicMock()
        process.stdout.fileno.return_value = 999
        process.poll.return_value = None
        selector = MagicMock()
        selector.__enter__.return_value = selector
        selector.select.return_value = [(None, None)]
        with patch.object(collector.subprocess, "Popen", return_value=process), \
             patch.object(collector.os, "set_blocking"), \
             patch.object(collector.os, "read", return_value=b"x" * 1024), \
             patch.object(collector.selectors, "DefaultSelector", return_value=selector):
            self.assert_status("LIMIT_EXCEEDED", collector.run_systemd_version)
        process.kill.assert_called_once_with()

    def test_global_timeout_outputs_no_partial_authority(self):
        with patch.object(collector.sys, "platform", "linux"), \
             patch.object(collector.signal, "signal"), patch.object(collector.signal, "alarm") as alarm, \
             patch.object(collector, "collect_facts", side_effect=collector.CollectionDeadline()), \
             patch("builtins.print") as output:
            self.assertEqual(collector.main([]), 2)
        alarm.assert_any_call(collector.COLLECTION_TIMEOUT)
        alarm.assert_any_call(0)
        result = json.loads(output.call_args.args[0])
        self.assertEqual(result["collectionStatus"], "TIMEOUT")
        self.assertEqual(result["status"], "UNVERIFIED")
        self.assertEqual(set(result["missingFacts"]), set(collector.FACT_SOURCES))


if __name__ == "__main__":
    unittest.main()
