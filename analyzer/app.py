"""Curator audio analyzer: Essentia Discogs-EffNet styles, voice, danceability, moods,
instruments and a 1280-d sound embedding for a library file.

POST /analyze {"path": "/music/..."} -> JSON
GET  /healthz, GET /version
"""
import base64
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from essentia.standard import MonoLoader, TensorflowPredict2D, TensorflowPredictEffnetDiscogs

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
MUSIC_ROOT = os.path.realpath(os.environ.get("MUSIC_ROOT", "/music"))
MAX_SECONDS = float(os.environ.get("MAX_SECONDS", "600"))
WORKERS = int(os.environ.get("WORKERS", "2"))
MODEL_VERSION = "discogs-effnet-bs64-1+heads-1"
SAMPLE_RATE = 16000

_slots = threading.BoundedSemaphore(WORKERS)
_local = threading.local()


def _meta(name):
    with open(os.path.join(MODEL_DIR, name + ".json"), encoding="utf-8") as handle:
        return json.load(handle)


def _output_name(meta, purpose, default):
    for output in meta.get("schema", {}).get("outputs", []):
        if output.get("output_purpose") == purpose:
            return output["name"]
    return default


def _input_name(meta, default):
    inputs = meta.get("schema", {}).get("inputs", [])
    return inputs[0]["name"] if inputs else default


HEADS = {
    "genre": ("genre_discogs400-discogs-effnet-1", "model/Softmax"),
    "voice": ("voice_instrumental-discogs-effnet-1", "model/Softmax"),
    "danceability": ("danceability-discogs-effnet-1", "model/Softmax"),
    "instrument": ("mtg_jamendo_instrument-discogs-effnet-1", "model/Sigmoid"),
    "mood_aggressive": ("mood_aggressive-discogs-effnet-1", "model/Softmax"),
    "mood_happy": ("mood_happy-discogs-effnet-1", "model/Softmax"),
    "mood_relaxed": ("mood_relaxed-discogs-effnet-1", "model/Softmax"),
    "mood_sad": ("mood_sad-discogs-effnet-1", "model/Softmax"),
}
METADATA = {key: _meta(name) for key, (name, _) in HEADS.items()}
EMBEDDING_META = _meta("discogs-effnet-bs64-1")


def _models():
    """TensorFlow graphs are not shared across threads; each worker thread loads its own."""
    if getattr(_local, "models", None) is None:
        embed = TensorflowPredictEffnetDiscogs(
            graphFilename=os.path.join(MODEL_DIR, "discogs-effnet-bs64-1.pb"),
            output=_output_name(EMBEDDING_META, "embeddings", "PartitionedCall:1"),
        )
        heads = {}
        for key, (name, default_output) in HEADS.items():
            meta = METADATA[key]
            heads[key] = TensorflowPredict2D(
                graphFilename=os.path.join(MODEL_DIR, name + ".pb"),
                input=_input_name(meta, "model/Placeholder"),
                output=_output_name(meta, "predictions", default_output),
            )
        _local.models = (embed, heads)
    return _local.models


def _labelled(key, values):
    return dict(zip(METADATA[key]["classes"], (float(v) for v in values)))


def _positive(key, values, positive):
    return _labelled(key, values).get(positive)


def analyze(path):
    real = os.path.realpath(path)
    if not real.startswith(MUSIC_ROOT + os.sep) or not os.path.isfile(real):
        raise ValueError("path must be a file inside the music library")
    started = time.time()
    audio = MonoLoader(filename=real, sampleRate=SAMPLE_RATE, resampleQuality=4)()
    limit = int(MAX_SECONDS * SAMPLE_RATE)
    if len(audio) > limit:  # analyse the central part of very long recordings
        offset = (len(audio) - limit) // 2
        audio = audio[offset:offset + limit]
    if len(audio) < SAMPLE_RATE * 3:
        raise ValueError("recording is shorter than three seconds")
    embed, heads = _models()
    frames = embed(audio)
    result = {key: np.mean(heads[key](frames), axis=0) for key in heads}
    genre = _labelled("genre", result["genre"])
    styles = sorted(genre.items(), key=lambda item: item[1], reverse=True)[:15]
    instruments = sorted(_labelled("instrument", result["instrument"]).items(), key=lambda item: item[1], reverse=True)
    embedding = np.mean(frames, axis=0).astype("<f4")
    return {
        "modelVersion": MODEL_VERSION,
        "analyzedSeconds": round(len(audio) / SAMPLE_RATE, 1),
        "styles": [{"label": label, "p": round(p, 4)} for label, p in styles],
        "voice": _positive("voice", result["voice"], "voice"),
        "danceable": _positive("danceability", result["danceability"], "danceable"),
        "moods": {
            "aggressive": _positive("mood_aggressive", result["mood_aggressive"], "aggressive"),
            "happy": _positive("mood_happy", result["mood_happy"], "happy"),
            "relaxed": _positive("mood_relaxed", result["mood_relaxed"], "relaxed"),
            "sad": _positive("mood_sad", result["mood_sad"], "sad"),
        },
        "instruments": [{"label": label, "p": round(p, 4)} for label, p in instruments if p >= 0.1][:10],
        "embedding": base64.b64encode(embedding.tobytes()).decode("ascii"),
        "dimensions": int(embedding.shape[0]),
        "elapsedSeconds": round(time.time() - started, 2),
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            return self._send(200, {"ok": True})
        if self.path == "/version":
            return self._send(200, {"modelVersion": MODEL_VERSION, "workers": WORKERS})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/analyze":
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8192:
                return self._send(400, {"error": "invalid request"})
            path = json.loads(self.rfile.read(length)).get("path", "")
            if not _slots.acquire(timeout=600):
                return self._send(503, {"error": "analyzer busy"})
            try:
                return self._send(200, analyze(str(path)))
            finally:
                _slots.release()
        except ValueError as error:
            return self._send(422, {"error": str(error)})
        except Exception as error:  # report decoding/model failures to the caller
            return self._send(500, {"error": f"{type(error).__name__}: {error}"})

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), Handler).serve_forever()
