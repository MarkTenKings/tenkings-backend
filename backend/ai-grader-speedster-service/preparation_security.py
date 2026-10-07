"""Private CPU transport settings; these never constitute release admission."""

import hmac
import os
import re
from urllib.parse import urlsplit

import requests


def preparation_transport_config():
    key = os.environ.get("ATLAS_PREPARATION_API_KEY", "")
    origin = os.environ.get("ATLAS_PREPARATION_OBJECT_ORIGIN", "")
    parsed = urlsplit(origin)
    if (not re.fullmatch(r"[A-Za-z0-9_+/=-]{32,128}", key)
            or parsed.scheme != "https" or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path or parsed.query or parsed.fragment
            or origin != "https://" + parsed.netloc):
        raise ValueError("Preparation private transport configuration is unavailable")
    return key, origin


def authorized_preparation(header):
    key, _ = preparation_transport_config()
    return isinstance(header, str) and hmac.compare_digest(header, "Bearer " + key)


def require_object_url(value):
    _, origin = preparation_transport_config()
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or "https://" + parsed.netloc != origin
            or parsed.username is not None or parsed.password is not None or parsed.fragment):
        raise ValueError("An exact private storage origin is required")
    return value


def private_object_get(url, **options):
    require_object_url(url)
    response = requests.get(url, **options, allow_redirects=False)
    if response.status_code != 200:
        response.close()
        raise ValueError("Private source read did not complete")
    return response


def private_object_put(url, **options):
    require_object_url(url)
    response = requests.put(url, **options, allow_redirects=False)
    if response.status_code not in (200, 201, 204):
        response.close()
        raise ValueError("Private artifact upload did not complete")
    return response
