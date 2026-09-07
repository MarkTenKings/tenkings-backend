ARG PYTHON_BASE_IMAGE=python@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a
FROM ${PYTHON_BASE_IMAGE}

ARG SPEEDSTER_SOURCE_REPOSITORY=UNSET
ARG SPEEDSTER_SOURCE_COMMIT_SHA=UNSET
ARG SPEEDSTER_SOURCE_TREE_SHA=UNSET
ARG SPEEDSTER_BUILD_ID=UNSET
ARG SPEEDSTER_OCI_IMAGE_REFERENCE=UNSET
ARG SAM3_CHECKPOINT_REVISION=3c879f39826c281e95690f02c7821c4de09afae7
ARG SAM3_CHECKPOINT_SHA256=9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e
ARG SPEEDSTER_COMPILER_PACKAGE_VERSION=14.2.0-19
ARG SPEEDSTER_LIBC_DEV_PACKAGE_VERSION=2.41-12+deb13u3
ARG SPEEDSTER_COMPILER_VERSION=14.2.0
ARG SPEEDSTER_COMPILER_TARGET=x86_64-linux-gnu

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CUBLAS_WORKSPACE_CONFIG=:4096:8 \
    PORT=8080 \
    HF_HOME=/models/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    SPEEDSTER_SOURCE_REPOSITORY=${SPEEDSTER_SOURCE_REPOSITORY} \
    SPEEDSTER_SOURCE_COMMIT_SHA=${SPEEDSTER_SOURCE_COMMIT_SHA} \
    SPEEDSTER_SOURCE_TREE_SHA=${SPEEDSTER_SOURCE_TREE_SHA} \
    SPEEDSTER_BUILD_ID=${SPEEDSTER_BUILD_ID} \
    SPEEDSTER_OCI_IMAGE_REFERENCE=${SPEEDSTER_OCI_IMAGE_REFERENCE} \
    SAM3_CHECKPOINT_REVISION=${SAM3_CHECKPOINT_REVISION} \
    SAM3_CHECKPOINT_SHA256=${SAM3_CHECKPOINT_SHA256}

LABEL org.opencontainers.image.source=${SPEEDSTER_SOURCE_REPOSITORY} \
      org.opencontainers.image.revision=${SPEEDSTER_SOURCE_COMMIT_SHA} \
      org.opencontainers.image.version=${SPEEDSTER_BUILD_ID} \
      io.tenkings.speedster.source-tree=${SPEEDSTER_SOURCE_TREE_SHA} \
      io.tenkings.speedster.sam3-checkpoint-revision=${SAM3_CHECKPOINT_REVISION} \
      io.tenkings.speedster.sam3-checkpoint-sha256=${SAM3_CHECKPOINT_SHA256} \
      io.tenkings.speedster.cublas-workspace-config=":4096:8" \
      io.tenkings.speedster.compiler.cc="/usr/bin/gcc-14" \
      io.tenkings.speedster.compiler.package-version=${SPEEDSTER_COMPILER_PACKAGE_VERSION} \
      io.tenkings.speedster.compiler.libc-dev-package-version=${SPEEDSTER_LIBC_DEV_PACKAGE_VERSION} \
      io.tenkings.speedster.compiler.version=${SPEEDSTER_COMPILER_VERSION} \
      io.tenkings.speedster.compiler.target=${SPEEDSTER_COMPILER_TARGET}

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir pycocotools==2.0.11 psutil==7.2.2
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      "gcc-14=${SPEEDSTER_COMPILER_PACKAGE_VERSION}" \
      "libc6-dev=${SPEEDSTER_LIBC_DEV_PACKAGE_VERSION}" \
    && rm -rf /var/lib/apt/lists/*
ENV CC=/usr/bin/gcc-14 \
    SPEEDSTER_COMPILER_PACKAGE_VERSION=${SPEEDSTER_COMPILER_PACKAGE_VERSION} \
    SPEEDSTER_LIBC_DEV_PACKAGE_VERSION=${SPEEDSTER_LIBC_DEV_PACKAGE_VERSION} \
    SPEEDSTER_COMPILER_VERSION=${SPEEDSTER_COMPILER_VERSION} \
    SPEEDSTER_COMPILER_TARGET=${SPEEDSTER_COMPILER_TARGET}
COPY . .
COPY speedster-entrypoint.sh /usr/local/bin/speedster-entrypoint
COPY compiler_probe.c /usr/local/share/speedster/compiler_probe.c
RUN chmod 0555 /usr/local/bin/speedster-entrypoint

ENTRYPOINT ["/usr/local/bin/speedster-entrypoint"]
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port \"${PORT}\" --workers 1"]
