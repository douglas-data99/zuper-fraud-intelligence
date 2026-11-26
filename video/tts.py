"""Narração com a voz "Douglas profissional" (ElevenLabs). Cache por fala; chave lida do SITES/.env (nunca impressa)."""
import json, os, subprocess, urllib.request
from pathlib import Path
AQUI = Path(__file__).resolve().parent
ENV = AQUI.parents[2] / ".env"
VOZ, MODELO = "1JIKv6Cy3mQq5VVjeAUk", "eleven_v4"
OUT = AQUI / "_build" / "audio"
def chave():
    for ln in ENV.read_text(encoding="utf-8").splitlines():
        if ln.startswith("ELEVENLABS_API_KEY="):
            return ln.split("=", 1)[1].strip().strip("\"'")
def dur(a):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(a)], capture_output=True, text=True).stdout)
duracoes = {}
for f in json.load(open(AQUI / "roteiro.json", encoding="utf-8")):
    bruto, limpo = OUT / f"{f['id']}_raw.mp3", OUT / f"{f['id']}.wav"
    if not bruto.exists():
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOZ}?output_format=mp3_44100_128",
            data=json.dumps({"text": f["texto"], "model_id": MODELO}).encode(), headers={"xi-api-key": chave(), "Content-Type": "application/json"})
        bruto.write_bytes(urllib.request.urlopen(req, timeout=240).read())
        print("tts", f["id"])
    # corte seco: tira silêncio das pontas (sem acelerar a voz)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(bruto), "-af",
                    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse",
                    "-ar", "44100", "-ac", "1", str(limpo)], check=True)
    duracoes[f["id"]] = round(dur(limpo), 3)
(AQUI / "_build" / "duracoes.json").write_text(json.dumps(duracoes, indent=1), encoding="utf-8")
print("total", round(sum(duracoes.values()), 1), "s")
