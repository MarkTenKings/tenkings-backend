"""Bound, CPU-only preparation; no detector routes or model startup."""

import re
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ConfigDict, Field, field_validator, model_validator

from color_geometry import ENGINE_VERSION, POLICY_PROVENANCE
from preparation_core import (
    Point, PreparedUploads, PrepareRequest, PrepareResponse, PreparationPorts,
    prepare_image as run_preparation, upload_webp,
)
from preparation_evidence import MAX_BYTES, preparation_identity, load_preparation_bytes
from preparation_security import authorized_preparation, require_object_url, private_object_get, private_object_put


def frozen_https_url(value):
    if value is None:
        return value
    parsed = urlsplit(value)
    if (not 1 <= len(value) <= 16384 or parsed.scheme != "https" or not parsed.hostname
            or parsed.username is not None or parsed.password is not None or parsed.fragment):
        raise ValueError("A server-issued HTTPS object URL is required")
    return require_object_url(value)


class UnitPoint(Point):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    y: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)


class BoundPreparedUploads(PreparedUploads):
    model_config = ConfigDict(extra="forbid")
    inspection: str

    @field_validator("rectified", "inspection", "normalized", "microDefect", "directional")
    @classmethod
    def server_upload_url(cls, value):
        return frozen_https_url(value)

    @model_validator(mode="after")
    def distinct_roles(self):
        if len(set(self.model_dump().values())) != 5:
            raise ValueError("Each prepared role requires its own upload object")
        return self


class BoundPrepareRequest(PrepareRequest):
    model_config = ConfigDict(extra="forbid")
    imageBase64: str | None = Field(default=None, max_length=4 * ((MAX_BYTES + 2) // 3) + 128)
    corners: list[UnitPoint] = Field(min_length=4, max_length=4)
    outputUploads: BoundPreparedUploads
    matColor: Literal["BLACK", "WHITE", "MAGENTA"]
    preparationBinding: dict[str, str]

    @field_validator("imageUrl")
    @classmethod
    def server_source_url(cls, value):
        return frozen_https_url(value)

    @field_validator("preparationBinding")
    @classmethod
    def exact_attempt(cls, value):
        uuid = r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"
        if (set(value) != {"attemptId", "dispatchClaimId", "requestSha256", "inputSha256", "sourceSha256"}
                or any(not re.fullmatch(uuid, value[key]) for key in ("attemptId", "dispatchClaimId"))
                or any(not re.fullmatch(r"[a-f0-9]{64}", value[key]) for key in ("requestSha256", "inputSha256", "sourceSha256"))):
            raise ValueError("An exact preparation attempt binding is required")
        return value

    @model_validator(mode="after")
    def one_frozen_source(self):
        if bool(self.imageUrl) == bool(self.imageBase64):
            raise ValueError("Exactly one frozen source is required")
        return self


app = FastAPI(title="Speedster CPU preparation", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def private_preparation(request, call_next):
    if request.url.path == "/prepare":
        try:
            authorized = authorized_preparation(request.headers.get("authorization"))
        except ValueError:
            return JSONResponse(status_code=503, content={"detail": "Private preparation is unavailable"})
        if not authorized:
            return JSONResponse(status_code=401, content={"detail": "Private preparation authorization is required"})
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    # Validation's default response includes source bytes and signed URL input.
    return JSONResponse(status_code=422, content={"detail": "An exact bound preparation request is required"})


@app.get("/health")
@app.get("/ping")
def health():
    try:
        identity = preparation_identity()
    except ValueError as error:
        raise HTTPException(status_code=503, detail="Preparation release identity is unavailable") from error
    return {
        "ok": True,
        "service": "speedster-preparation",
        "capabilities": ["PREPARE_SIDE"],
        "preparationIdentity": identity,
        "colorGeometryEngineVersion": ENGINE_VERSION,
        "colorGeometryPolicyProvenance": POLICY_PROVENANCE,
    }


@app.post("/prepare", response_model=PrepareResponse)
def prepare_image(request: BoundPrepareRequest):
    try:
        # Fail before reading or uploading any object when this artifact cannot
        # state its actual immutable release identity. This is not admission.
        identity = preparation_identity()
    except ValueError as error:
        raise HTTPException(status_code=503, detail="Preparation release identity is unavailable") from error
    try:
        return run_preparation(request, PreparationPorts(
            preparation_identity=lambda: identity,
            load_preparation_bytes=lambda url, encoded: load_preparation_bytes(url, encoded, get=private_object_get),
            upload_webp=lambda url, image: upload_webp(url, image, put=private_object_put),
        ))
    except HTTPException as error:
        # requests exceptions can contain signed object URLs. The shared legacy
        # pipeline retains its status, while this service returns a bounded text.
        raise HTTPException(status_code=error.status_code, detail="Preparation could not complete the exact request") from error
