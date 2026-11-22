FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MODEL_DIR=/models MUSIC_ROOT=/music \
    TF_CPP_MIN_LOG_LEVEL=2 OMP_NUM_THREADS=3
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "numpy==1.26.4" "essentia-tensorflow==2.1b6.dev1110"
WORKDIR /models
COPY models.sha256 ./
# The model host is slow and occasionally drops connections: resume and retry, then verify.
RUN set -eu; base=https://essentia.upf.edu/models; \
    for name in $(awk '{print $2}' models.sha256); do \
      case "$name" in discogs-effnet-bs64-1.*) dir=feature-extractors/discogs-effnet ;; \
        *) dir=classification-heads/${name%%-discogs-effnet-1.*} ;; esac; \
      curl -fsSL -C - --retry 8 --retry-all-errors --retry-delay 5 --max-time 600 -o "$name" "$base/$dir/$name"; \
    done; sha256sum -c models.sha256
WORKDIR /app
COPY app.py MODELS.md ./
USER 1001:1001
EXPOSE 8000
CMD ["python", "/app/app.py"]
