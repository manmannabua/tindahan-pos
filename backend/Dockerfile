# syntax=docker/dockerfile:1.7
# Multi-stage build: dependencies are resolved with uv from the lockfile, the runtime image
# contains only the virtualenv and the application code, and runs as a non-root user.

FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app

FROM base AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
ARG INSTALL_DEV=false
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ "$INSTALL_DEV" = "true" ]; then uv sync --frozen --no-install-project; \
    else uv sync --frozen --no-install-project --no-dev; fi

FROM base AS runtime
RUN groupadd --system app && useradd --system --gid app --home /app app
COPY --from=builder /app/.venv /app/.venv
COPY --chown=app:app . .
ENV PATH="/app/.venv/bin:$PATH"
USER app
EXPOSE 8000
# Production default; docker-compose.yml overrides this for development (--reload).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", "--proxy-headers", "--forwarded-allow-ips", "*"]
