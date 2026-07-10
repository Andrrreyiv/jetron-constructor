import os
import imageio_ffmpeg
os.environ["PATH"] = os.path.dirname(imageio_ffmpeg.get_ffmpeg_exe()) + os.pathsep + os.environ["PATH"]
# whisper calls "ffmpeg"; imageio binary is named ffmpeg-win-*.exe, so alias it
import shutil
_ff = imageio_ffmpeg.get_ffmpeg_exe()
_dst = os.path.join(os.path.dirname(_ff), "ffmpeg.exe")
if not os.path.exists(_dst):
    shutil.copy(_ff, _dst)
import whisper

DL = r"C:\Users\Андрей\Downloads"
files = [
    "voice_10-07-2026_11-58-34",
    "voice_10-07-2026_11-59-26",
    "voice_10-07-2026_12-06-02",
    "voice_10-07-2026_12-06-38",
    "voice_10-07-2026_12-08-08",
    "voice_10-07-2026_12-09-46",
    "voice_10-07-2026_12-11-23",
    "voice_10-07-2026_12-12-59",
    "voice_10-07-2026_12-16-03",
    "voice_10-07-2026_12-16-44",
    "voice_10-07-2026_12-18-17",
    "voice_10-07-2026_12-21-46",
]

model = whisper.load_model("small")
outpath = os.path.join(os.path.dirname(__file__), "voice-answers-2026-07-10.txt")
fh = open(outpath, "w", encoding="utf-8")
for f in files:
    path = os.path.join(DL, f)
    ts = f.replace("voice_10-07-2026_", "").replace("-", ":")
    try:
        r = model.transcribe(path, language="ru")
        text = str(r["text"]).strip()
    except Exception as e:
        text = f"[ERROR: {e}]"
    block = f"=== [{ts}] {f} ===\n{text}\n"
    print("done:", f, flush=True)
    fh.write(block + "\n")
    fh.flush()
fh.close()
print("SAVED")
