"""
Text to speech.

ElevenLabs when a key is present, browser speechSynthesis otherwise.

The key stays here, server-side. The browser asks /api/speak for audio and gets
mp3 bytes back — it never sees the key, so nothing leaks into devtools, the
page source, or a screen recording.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

# Rachel — calm, British-adjacent. Override with ELEVENLABS_VOICE_ID.
DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"


def _env_float(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(0.0, min(1.0, float(raw)))
    except ValueError:
        return default


def _env_bool(name, default=False):
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def model_id():
    # Match the model you pick on elevenlabs.io — site preview often uses v4, not multilingual_v2.
    return os.environ.get("ELEVENLABS_MODEL", "eleven_v4").strip() or "eleven_v4"


def output_format():
    fmt = os.environ.get("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128").strip()
    allowed = {
        "mp3_44100_128", "mp3_44100_192", "mp3_44100_96", "mp3_44100_64", "mp3_44100_32",
        "mp3_22050_32",
    }
    return fmt if fmt in allowed else "mp3_44100_128"


def language_code():
    return os.environ.get("ELEVENLABS_LANGUAGE", "en").strip() or None


def optional_seed():
    raw = os.environ.get("ELEVENLABS_SEED", "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def voice_settings():
    return {
        "stability": _env_float("ELEVENLABS_STABILITY", 0.58),
        "similarity_boost": _env_float("ELEVENLABS_SIMILARITY", 0.62),
        "style": _env_float("ELEVENLABS_STYLE", 0.08),
        "use_speaker_boost": _env_bool("ELEVENLABS_SPEAKER_BOOST", False),
    }


def available():
    return bool(os.environ.get("ELEVENLABS_API_KEY"))


def voice_id():
    return os.environ.get("ELEVENLABS_VOICE_ID", DEFAULT_VOICE)


def speak(text):
    """Returns mp3 bytes, or raises. Caller decides what to do on failure."""
    if not available():
        raise RuntimeError("no ELEVENLABS_API_KEY")
    text = (text or "").strip()
    if not text:
        raise ValueError("empty text")

    params = urllib.parse.urlencode({"output_format": output_format()})
    payload = {
        "text": text[:2500],
        "model_id": model_id(),
        "voice_settings": voice_settings(),
    }
    lang = language_code()
    if lang and "multilingual_v2" not in model_id():
        payload["language_code"] = lang
    seed = optional_seed()
    if seed is not None:
        payload["seed"] = seed

    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id()}?{params}",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "content-type": "application/json",
            "accept": "audio/mpeg",
            "xi-api-key": os.environ["ELEVENLABS_API_KEY"],
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def transcribe(audio, mime="audio/webm"):
    """Speech to text via ElevenLabs Scribe. Returns the transcript, or raises.

    Used instead of the browser's Web Speech API because that one only exists in
    Chrome and is a silently-failing stub in Brave — and because it ships your
    audio to Google. This keeps listening on the same provider as speaking.
    """
    if not available():
        raise RuntimeError("no ELEVENLABS_API_KEY")
    if not audio:
        raise ValueError("empty audio")

    ext = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4",
           "audio/mpeg": "mp3", "audio/wav": "wav"}.get(mime.split(";")[0], "webm")
    boundary = "----jarvis" + os.urandom(8).hex()
    b = boundary.encode()

    body = b"".join([
        b"--", b, b"\r\n",
        b'Content-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1\r\n',
        b"--", b, b"\r\n",
        f'Content-Disposition: form-data; name="file"; filename="turn.{ext}"\r\n'.encode(),
        f"Content-Type: {mime}\r\n\r\n".encode(),
        audio, b"\r\n",
        b"--", b, b"--\r\n",
    ])

    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/speech-to-text",
        data=body, method="POST",
        headers={
            "content-type": f"multipart/form-data; boundary={boundary}",
            "xi-api-key": os.environ["ELEVENLABS_API_KEY"],
        },
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        return (json.loads(r.read()).get("text") or "").strip()


def voices():
    """List the account's voices, so you can find an id to put in .env."""
    if not available():
        return []
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v2/voices",
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.loads(r.read())
    except Exception:                                  # noqa: BLE001
        return []
    return [dict(id=v.get("voice_id"), name=v.get("name"),
                 labels=v.get("labels", {}))
            for v in body.get("voices", [])]
