import os, sys
sys.stdout.reconfigure(encoding='utf-8')
from faster_whisper import WhisperModel
DL = r"C:\Users\Андрей\Downloads"
names = ["voice_08-07-2026_19-00-34.ogg", "voice_08-07-2026_19-01-35.ogg"]
files = [os.path.join(DL, n) for n in names]
print("Загружаю модель...", flush=True)
model = WhisperModel("small", device="cpu", compute_type="int8")
out_path = r"C:\Projects\jetron-constructor\docs\voice-answers-batch4.txt"
with open(out_path, "w", encoding="utf-8") as out:
    for i, f in enumerate(files, 1):
        name = os.path.basename(f)
        ts = name.replace("voice_08-07-2026_", "").replace(".ogg", "").replace("-", ":")
        print(f"\n[{i}/{len(files)}] {name} ...", flush=True)
        segments, info = model.transcribe(f, language="ru", beam_size=5, vad_filter=True)
        text = " ".join(s.text.strip() for s in segments).strip()
        out.write(f"\n===== [{i}] Голосовое {ts} =====\n" + text + "\n")
        out.flush()
        print(text, flush=True)
print("\n\nГОТОВО.", flush=True)
