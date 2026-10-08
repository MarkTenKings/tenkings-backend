"""Materialize a locked pnpm dependency graph as ordinary nested directories.

Dereferencing a top-level pnpm link alone loses that package's sibling deps.
Resolve each declared runtime dependency from its original real package path
before copying, retaining exact installed versions without a registry lookup.
"""
import json
import shutil
from pathlib import Path

def locate(package, dependency):
    for ancestor in [package, *package.parents]:
        candidate = ancestor / 'node_modules' / dependency
        if (candidate / 'package.json').is_file():
            return candidate.resolve()
    return None

def copy_dependencies(package, destination, ancestors=()):
    package, destination = Path(package).resolve(), Path(destination)
    metadata = json.loads((package / 'package.json').read_text())
    required = metadata.get('dependencies', {})
    optional = metadata.get('optionalDependencies', {})
    peers = metadata.get('peerDependencies', {})
    for name in sorted({**required, **optional, **peers}):
        source = locate(package, name)
        if source is None:
            if name in optional or metadata.get('peerDependenciesMeta', {}).get(name, {}).get('optional'):
                continue
            raise ValueError('Locked runtime dependency missing: ' + name)
        # Ordinary npm resolution finds a previously copied ancestor for cycles.
        if source in ancestors:
            continue
        target = destination / 'node_modules' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, target, symlinks=False, ignore=shutil.ignore_patterns('node_modules', '__pycache__'))
        copy_dependencies(source, target, (*ancestors, package))
