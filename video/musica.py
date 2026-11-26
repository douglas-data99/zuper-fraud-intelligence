import json, urllib.request
from pathlib import Path
AQUI = Path(__file__).resolve().parent
ENV = AQUI.parents[2] / ".env"
k = next(l.split("=", 1)[1].strip().strip("\"'") for l in ENV.read_text(encoding="utf-8").splitlines() if l.startswith("ELEVENLABS_API_KEY="))
dest = AQUI / "_build" / "musica.mp3"
if not dest.exists():
    corpo = {"prompt": "Calm, confident modern tech documentary background music. Minimal electronic pulse, soft synth pads, subtle steady beat, "
                       "no vocals, no drops, low energy so narration stays clear, polished and premium, slowly evolving.",
             "music_length_ms": 270000, "force_instrumental": True}
    req = urllib.request.Request("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", data=json.dumps(corpo).encode(),
                                 headers={"xi-api-key": k, "Content-Type": "application/json"})
    dest.write_bytes(urllib.request.urlopen(req, timeout=600).read())
print("ok", dest.stat().st_size)
