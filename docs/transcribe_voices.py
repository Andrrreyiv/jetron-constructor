import sys, glob, os
from faster_whisper import WhisperModel

DL = r"C:\Users\Андрей\Downloads"
files = sorted(glob.glob(os.path.join(DL, "voice_08-07-2026_*")))
files = [f for f in files if not f.endswith(".txt")]

print(f"Найдено файлов: {len(files)}", flush=True)
for f in files:
    print("  ", os.path.basename(f), flush=True)

print("\nЗагружаю модель small (int8)...", flush=True)
model = WhisperModel("small", device="cpu", compute_type="int8")

out_path = os.path.join(DL, "TRANSCRIPT_ALL.txt")
with open(out_path, "w", encoding="utf-8") as out:
    for i, f in enumerate(files, 1):
        name = os.path.basename(f)
        ts = name.replace("voice_08-07-2026_", "").replace(".ogg", "").replace("-", ":")
        print(f"\n[{i}/{len(files)}] {name} ...", flush=True)
        segments, info = model.transcribe(f, language="ru", beam_size=5, vad_filter=True)
        text = " ".join(s.text.strip() for s in segments).strip()
        header = f"\n===== [{i}] Голосовое {ts} =====\n"
        out.write(header + text + "\n")
        out.flush()
        print(text, flush=True)

print(f"\n\nГОТОВО. Файл: {out_path}", flush=True)
