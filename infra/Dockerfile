# Multi-stage Dockerfile for the FastAPI backend (web + worker share the image).
# Switch role by setting ROLE=web|worker in env; the entrypoint picks the uvicorn target.

FROM python:3.12-slim AS builder
WORKDIR /build

# System deps for git + tree-sitter compilation.
RUN apt-get update -y && apt-get install -y --no-install-recommends \
        git build-essential ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY reviewer ./reviewer
COPY app ./app
COPY CODE_REVIEW_RULESET.md ./

RUN pip install --upgrade pip && pip install --prefix=/install .

# ---- Runtime ----
FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends \
        git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 reviewer

COPY --from=builder /install /usr/local
COPY --from=builder /build /app
RUN chown -R reviewer:reviewer /app

USER reviewer

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    REVIEWER_WORK_DIR=/tmp/reviewer

EXPOSE 8000

# `ROLE` decides which app to run: web (default) or worker (when we split later).
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "uvicorn app.web:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_WORKERS:-2}"]
