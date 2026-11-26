import json
from pathlib import Path
from faster_whisper import WhisperModel
AQUI = Path(__file__).resolve().parent
m = WhisperModel("small", device="cpu", compute_type="int8")
out = {}
for f in json.load(open(AQUI / "roteiro.json", encoding="utf-8")):
    segs, _ = m.transcribe(str(AQUI / "_build" / "audio" / f"{f['id']}.wav"), language="pt", word_timestamps=True, beam_size=5)
    ws = [{"w": w.word.strip(), "t": round(w.start, 2)} for s in segs for w in s.words]
    out[f["id"]] = ws
    print(f["id"], " ".join(w["w"] for w in ws)[:160])
(AQUI / "_build" / "palavras.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
