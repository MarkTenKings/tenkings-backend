#!/usr/bin/env python3
"""Bounded, read-only Linux facts; never a decoder qualification or capability."""

import argparse
import datetime
import errno
import json
import os
import posixpath
import re
import selectors
import shlex
import signal
import socket
import stat
import subprocess
import sys
import time


SCHEMA = "atlas-proof-decoder-target-facts-v1"
FILE_LIMIT = 8192
MOUNT_LIMIT = 262144
HEADER_LIMIT = 8192
BODY_LIMIT = 65536
WIRE_LIMIT = 98304
COMMAND_LIMIT = 4096
SOCKET_TIMEOUT = 2.0
COMMAND_TIMEOUT = 1.0
COLLECTION_TIMEOUT = 10
SOCKET_PATHS = ("/run/docker.sock", "/var/run/docker.sock")
SYSTEMD_COMMAND = ("/usr/lib/systemd/systemd", "--version")
FILE_PATHS = frozenset((
    "/etc/os-release", "/usr/lib/os-release", "/proc/1/comm",
    "/proc/sys/kernel/random/boot_id", "/sys/fs/cgroup/cgroup.controllers",
    "/sys/fs/cgroup/cgroup.type", "/sys/module/apparmor/parameters/enabled",
    "/sys/kernel/security/lsm",
))
FACT_SOURCES = {
    "os": "/etc/os-release (or its /usr/lib/os-release target)",
    "machine": "uname.machine", "kernelRelease": "uname.release",
    "bootId": "/proc/sys/kernel/random/boot_id",
    "libc": "confstr.CS_GNU_LIBC_VERSION",
    "cgroupMount": "/proc/collector-pid/mountinfo: /sys/fs/cgroup",
    "cgroupControllers": "/sys/fs/cgroup/cgroup.controllers",
    "cgroupType": "/sys/fs/cgroup/cgroup.type",
    "apparmorEnabled": "/sys/module/apparmor/parameters/enabled",
    "lsm": "/sys/kernel/security/lsm", "systemdPid1": "/proc/1/comm",
    "systemdVersion": "/usr/lib/systemd/systemd --version",
    "dockerServer": "explicit AF_UNIX GET /version",
    "containerd": "explicit AF_UNIX GET /version: Components.containerd",
    "runc": "explicit AF_UNIX GET /version: Components.runc",
}


class FactError(Exception):
    def __init__(self, status):
        self.status = status


class CollectionDeadline(BaseException):
    pass


def observed(value):
    return {"status": "OBSERVED", "value": value}


def capture(action):
    try:
        return observed(action())
    except FactError as error:
        return {"status": error.status}
    except (FileNotFoundError, ProcessLookupError):
        return {"status": "MISSING"}
    except PermissionError:
        return {"status": "PERMISSION_DENIED"}
    except (TimeoutError, subprocess.TimeoutExpired):
        return {"status": "TIMEOUT"}
    except OSError:
        return {"status": "UNAVAILABLE"}
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return {"status": "MALFORMED"}


def require(condition, status="MALFORMED"):
    if not condition:
        raise FactError(status)


def bounded_text(value, limit=256):
    require(isinstance(value, str) and 0 < len(value) <= limit)
    require(all(32 <= ord(char) <= 126 for char in value))
    return value


def version(value):
    require(isinstance(value, str) and
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+:~_()-]{0,127}", value))
    return value


def _read_fixed_path(path, limit):
    """No symlink traversal, special device, credential path, or unbounded read."""
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    fd = None
    try:
        parts = path.split("/")[1:]
        for part in parts[:-1]:
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY |
                                os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
            os.close(directory)
            directory = following
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC |
                     os.O_NONBLOCK, dir_fd=directory)
        require(stat.S_ISREG(os.fstat(fd).st_mode), "UNSUPPORTED_FILE_TYPE")
        output = bytearray()
        while True:
            chunk = os.read(fd, min(4096, limit + 1 - len(output)))
            if not chunk:
                return bytes(output)
            output.extend(chunk)
            require(len(output) <= limit, "LIMIT_EXCEEDED")
    finally:
        if fd is not None:
            os.close(fd)
        os.close(directory)


def read_file(path):
    mount_path = "/proc/%d/mountinfo" % os.getpid()
    require(path in FILE_PATHS or path == mount_path, "REFUSED_PATH")
    try:
        data = _read_fixed_path(path, MOUNT_LIMIT if path == mount_path else FILE_LIMIT)
    except OSError as error:
        if path != "/etc/os-release" or error.errno != errno.ELOOP:
            raise
        # Ubuntu's one known os-release alias is allowed; arbitrary links are not.
        target = os.readlink("/etc/os-release")
        require(posixpath.normpath(posixpath.join("/etc", target)) ==
                "/usr/lib/os-release", "UNSUPPORTED_SYMLINK")
        data = _read_fixed_path("/usr/lib/os-release", FILE_LIMIT)
    return data.decode("utf-8", errors="strict")


def parse_os_release(text):
    keep = {"ID", "ID_LIKE", "NAME", "PRETTY_NAME", "VERSION", "VERSION_ID", "BUILD_ID"}
    result = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, raw = line.partition("=")
        require(separator and re.fullmatch(r"[A-Z][A-Z0-9_]*", key))
        if key in keep:
            require(key not in result)
            values = shlex.split(raw, comments=True, posix=True)
            require(len(values) == 1)
            result[key] = bounded_text(values[0])
    require("ID" in result and "VERSION_ID" in result)
    return result


def parse_boot_id(text):
    value = text.strip()
    require(re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", value))
    return value


def parse_tokens(text, separator=None):
    tokens = text.strip().split(separator)
    if tokens == [""]:
        tokens = []
    require(len(tokens) <= 32 and len(set(tokens)) == len(tokens))
    require(all(re.fullmatch(r"[a-z][a-z0-9_]{0,31}", token) for token in tokens))
    return tokens


def parse_cgroup_mount(text):
    matches = []
    for line in text.splitlines():
        left, separator, right = line.partition(" - ")
        require(separator)
        fields, tail = left.split(), right.split()
        require(len(fields) >= 6 and len(tail) >= 3)
        if fields[4] == "/sys/fs/cgroup" and tail[0] == "cgroup2":
            flags = set(fields[5].split(","))
            matches.append({
                "filesystem": "cgroup2", "mountPoint": "/sys/fs/cgroup",
                "rootIsFilesystemRoot": fields[3] == "/",
                "mountFlags": sorted(flags & {"ro", "rw", "nosuid", "nodev", "noexec", "relatime"}),
            })
    require(len(matches) <= 1)
    require(bool(matches), "MISSING")
    return matches[0]


def parse_cgroup_type(text):
    value = text.strip()
    require(value in ("domain", "domain threaded", "domain invalid", "threaded"))
    return value


def parse_apparmor(text):
    require(text.strip() in ("Y", "N"))
    return text.strip() == "Y"


def run_systemd_version():
    """Only this fixed version command; no inherited environment or shell."""
    deadline = time.monotonic() + COMMAND_TIMEOUT
    process = subprocess.Popen(
        SYSTEMD_COMMAND, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, close_fds=True, shell=False,
        env={"LC_ALL": "C", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
    )
    output = bytearray()
    try:
        os.set_blocking(process.stdout.fileno(), False)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                require(remaining > 0, "TIMEOUT")
                require(bool(selector.select(remaining)), "TIMEOUT")
                chunk = os.read(process.stdout.fileno(), min(1024, COMMAND_LIMIT + 1 - len(output)))
                if not chunk:
                    break
                output.extend(chunk)
                require(len(output) <= COMMAND_LIMIT, "LIMIT_EXCEEDED")
        require(process.wait(timeout=max(0, deadline - time.monotonic())) == 0, "COMMAND_FAILED")
        return bytes(output).decode("utf-8", errors="strict")
    finally:
        if process.poll() is None:
            process.kill()  # Only this collector's own bounded --version child.
        process.stdout.close()
        try:
            process.wait(timeout=0.2)
        except subprocess.TimeoutExpired:
            pass


def parse_systemd_version(text):
    lines = text.splitlines()
    require(bool(lines))
    first = bounded_text(lines[0], 512)
    match = re.fullmatch(r"systemd ([0-9]{1,8})(?: \([ -~]{1,480}\))?", first)
    require(match is not None)
    return {"version": match.group(1), "versionLine": first}


def _decode_chunked(data):
    output = bytearray()
    position = 0
    for _ in range(1024):
        end = data.find(b"\r\n", position)
        require(end >= 0 and end - position <= 8)
        size_text = data[position:end]
        require(re.fullmatch(b"[0-9a-fA-F]{1,8}", size_text))
        size = int(size_text, 16)
        position = end + 2
        if size == 0:
            require(data[position:] == b"\r\n")  # No trailers or extra messages.
            return bytes(output)
        require(len(output) + size <= BODY_LIMIT, "LIMIT_EXCEEDED")
        require(position + size + 2 <= len(data))
        require(data[position + size:position + size + 2] == b"\r\n")
        output.extend(data[position:position + size])
        position += size + 2
    raise FactError("LIMIT_EXCEEDED")


def parse_version_http(wire):
    require(len(wire) <= WIRE_LIMIT, "LIMIT_EXCEEDED")
    head, separator, body = wire.partition(b"\r\n\r\n")
    require(separator and len(head) <= HEADER_LIMIT, "LIMIT_EXCEEDED")
    lines = head.split(b"\r\n")
    require(re.fullmatch(b"HTTP/1\.[01] 200 [ -~]{0,96}", lines[0]), "HTTP_REFUSED")
    require(len(lines) <= 65, "LIMIT_EXCEEDED")
    headers = {}
    for line in lines[1:]:
        key, colon, value = line.partition(b":")
        require(colon and re.fullmatch(b"[A-Za-z0-9-]{1,64}", key))
        key = key.lower()
        require(key not in headers)
        require(all(32 <= byte <= 126 or byte == 9 for byte in value))
        headers[key] = value.strip()
    require(headers.get(b"content-type", b"").split(b";", 1)[0].lower() == b"application/json")
    require(b"content-encoding" not in headers)
    if b"transfer-encoding" in headers:
        require(headers[b"transfer-encoding"].lower() == b"chunked" and b"content-length" not in headers)
        body = _decode_chunked(body)
    elif b"content-length" in headers:
        size = headers[b"content-length"]
        require(re.fullmatch(b"[0-9]{1,8}", size) and int(size) == len(body))
    require(len(body) <= BODY_LIMIT, "LIMIT_EXCEEDED")
    return body


def read_docker_version(path):
    require(path in SOCKET_PATHS, "REFUSED_PATH")
    deadline = time.monotonic() + SOCKET_TIMEOUT
    wire = bytearray()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(SOCKET_TIMEOUT)
        connection.connect(path)
        connection.settimeout(max(0.001, deadline - time.monotonic()))
        connection.sendall(b"GET /version HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n\r\n")
        while True:
            remaining = deadline - time.monotonic()
            require(remaining > 0, "TIMEOUT")
            connection.settimeout(remaining)
            chunk = connection.recv(min(4096, WIRE_LIMIT + 1 - len(wire)))
            if not chunk:
                break
            wire.extend(chunk)
            require(len(wire) <= WIRE_LIMIT, "LIMIT_EXCEEDED")
            if b"\r\n\r\n" not in wire:
                require(len(wire) <= HEADER_LIMIT + 4, "LIMIT_EXCEEDED")
    return parse_version_http(bytes(wire))


def parse_docker_version(body):
    require(isinstance(body, bytes) and len(body) <= BODY_LIMIT, "LIMIT_EXCEEDED")

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result

    def no_constant(_):
        raise FactError("MALFORMED")

    data = json.loads(body.decode("utf-8", errors="strict"), object_pairs_hook=pairs,
                      parse_constant=no_constant)
    require(isinstance(data, dict))
    server = {}
    for field in ("Version", "ApiVersion", "MinAPIVersion", "Os", "Arch"):
        require(field in data)
        server[field] = version(data[field])
    result = {"dockerServer": observed(server), "containerd": {"status": "MISSING"},
              "runc": {"status": "MISSING"}}
    components = data.get("Components", [])
    require(isinstance(components, list) and len(components) <= 16)
    for component in components:
        require(isinstance(component, dict))
        name = component.get("Name")
        if isinstance(name, str) and name in ("containerd", "runc"):
            require(result[name]["status"] == "MISSING" and "Version" in component)
            result[name] = observed(version(component["Version"]))
    return result


def collect_facts(docker_socket=None):
    require(docker_socket is None or docker_socket in SOCKET_PATHS, "REFUSED_PATH")
    facts = {}
    facts["os"] = capture(lambda: parse_os_release(read_file("/etc/os-release")))
    facts["machine"] = capture(lambda: version(os.uname().machine))
    facts["kernelRelease"] = capture(lambda: version(os.uname().release))
    facts["bootId"] = capture(lambda: parse_boot_id(read_file("/proc/sys/kernel/random/boot_id")))
    facts["libc"] = capture(lambda: bounded_text(os.confstr("CS_GNU_LIBC_VERSION")))
    facts["cgroupMount"] = capture(lambda: parse_cgroup_mount(read_file("/proc/%d/mountinfo" % os.getpid())))
    facts["cgroupControllers"] = capture(lambda: parse_tokens(read_file("/sys/fs/cgroup/cgroup.controllers")))
    facts["cgroupType"] = capture(lambda: parse_cgroup_type(read_file("/sys/fs/cgroup/cgroup.type")))
    facts["apparmorEnabled"] = capture(lambda: parse_apparmor(read_file("/sys/module/apparmor/parameters/enabled")))
    facts["lsm"] = capture(lambda: parse_tokens(read_file("/sys/kernel/security/lsm"), ","))
    facts["systemdPid1"] = capture(lambda: {"isSystemd": bounded_text(read_file("/proc/1/comm").strip()) == "systemd"})
    facts["systemdVersion"] = capture(lambda: parse_systemd_version(run_systemd_version()))
    if docker_socket is None:
        for key in ("dockerServer", "containerd", "runc"):
            facts[key] = {"status": "NOT_REQUESTED"}
    else:
        response = capture(lambda: parse_docker_version(read_docker_version(docker_socket)))
        if response["status"] == "OBSERVED":
            facts.update(response["value"])
        else:
            for key in ("dockerServer", "containerd", "runc"):
                facts[key] = dict(response)
    return facts


def report(facts, collection_status):
    complete = {}
    for key, source in FACT_SOURCES.items():
        complete[key] = {"source": source, **facts.get(key, {"status": "NOT_COLLECTED"})}
    return {
        "schema": SCHEMA, "status": "UNVERIFIED", "runtimeQualified": False,
        "executionAllowed": False, "collectionStatus": collection_status,
        "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "facts": complete,
        "missingFacts": [key for key, value in complete.items() if value["status"] != "OBSERVED"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker-socket", choices=SOCKET_PATHS,
                        help="Explicitly allow one local GET /version; omitted means no socket access.")
    args = parser.parse_args(argv)
    if sys.platform != "linux":
        parser.error("Linux-only; run only on the separately identity-bound R2 qualification VM")

    def expire(_signum, _frame):
        raise CollectionDeadline()

    previous_handler = signal.signal(signal.SIGALRM, expire)
    signal.alarm(COLLECTION_TIMEOUT)
    try:
        result = report(collect_facts(args.docker_socket), "COMPLETED")
    except CollectionDeadline:
        result = report({}, "TIMEOUT")
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)
    encoded = json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    require(len(encoded) <= 32768, "LIMIT_EXCEEDED")
    print(encoded)
    return 0 if result["collectionStatus"] == "COMPLETED" else 2


if __name__ == "__main__":
    sys.exit(main())
