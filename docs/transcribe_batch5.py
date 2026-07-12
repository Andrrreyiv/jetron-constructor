import subprocess
import numpy as np
import whisper
import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

files = [
    r"C:\Users\Андрей\Downloads\voice_12-07-2026_10-02-44.ogg",
    r"C:\Users\Андрей\Downloads\voice_12-07-2026_10-03-31.ogg",
    r"C:\Users\Андрей\Downloads\voice_12-07-2026_10-04-03.ogg",
    r"C:\Users\Андрей\Downloads\voice_12-07-2026_10-04-33.ogg",
    r"C:\Users\Андрей\Downloads\voice_12-07-2026_10-06-01",
    r"C:\Users\Андрей\Downloads\voice_12-07-2026_10-07-23",
]


def load_audio(path, sr=16000):
    cmd = [FFMPEG, "-nostdin", "-threads", "0", "-i", path,
           "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le", "-ar", str(sr), "-"]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, np.int16).flatten().astype(np.float32) / 32768.0


model = whisper.load_model("base")
out = []
for f in files:
    name = f.split("\\")[-1]
    print("=== " + name, flush=True)
    audio = load_audio(f)
    r = model.transcribe(audio, language="ru")
    text = str(r["text"]).strip()
    out.append("### " + name + "\n" + text)
    print(text, flush=True)

with open(r"C:\Projects\jetron-constructor\docs\voice-answers5.txt", "w", encoding="utf-8") as fh:
    fh.write("\n\n".join(out))
print("DONE", flush=True)
