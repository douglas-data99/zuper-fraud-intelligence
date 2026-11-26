"""Mixa voz + música (ducking) e junta com os quadros. Saída: _build/zuper-fraud-intelligence-apresentacao.mp4"""
import json, subprocess
from pathlib import Path
AQUI = Path(__file__).resolve().parent
B = AQUI / "_build"
LEAD, GAP, FIM = 0.6, 0.45, 2.5   # mesmos valores do video.html
rot = json.load(open(AQUI / "roteiro.json", encoding="utf-8"))
dur = json.load(open(B / "duracoes.json", encoding="utf-8"))
t, ins, filtros = LEAD, [], []
for i, f in enumerate(rot):
    ins += ["-i", str(B / "audio" / f"{f['id']}.wav")]
    filtros.append(f"[{i}:a]adelay={int(t*1000)}|{int(t*1000)},apad[v{i}]")
    t += dur[f["id"]] + GAP
total = t - GAP + FIM
n = len(rot)
voz = "".join(f"[v{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0:duration=longest,atrim=0:{total:.3f},asplit=2[voz][chave]"
mus = (f"[{n}:a]atrim=0:{total:.3f},volume=-17dB,afade=t=in:st=0:d=2,afade=t=out:st={total-3:.3f}:d=3[mus0];"
       f"[mus0][chave]sidechaincompress=threshold=0.03:ratio=6:attack=60:release=600[mus]")
mix = "[voz][mus]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
fc = ";".join(filtros + [voz, mus, mix])
subprocess.run(["ffmpeg", "-y", "-v", "error", *ins, "-i", str(B / "musica.mp3"), "-filter_complex", fc, "-map", "[aout]",
                "-ar", "48000", "-ac", "2", str(B / "trilha.wav")], check=True)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", "30", "-i", str(B / "quadros" / "%05d.jpg"), "-i", str(B / "trilha.wav"),
                "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                "-c:a", "aac", "-b:a", "160k", "-shortest", str(B / "zuper-fraud-intelligence-apresentacao.mp4")], check=True)
print("ok", round(total, 1), "s")
