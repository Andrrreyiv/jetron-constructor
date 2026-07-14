import subprocess, sys
import numpy as np
import whisper, imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def load_audio(path, sr=16000):
    cmd = [FFMPEG, "-nostdin", "-threads", "0", "-i", path,
           "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le", "-ar", str(sr), "-"]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, np.int16).flatten().astype(np.float32) / 32768.0

path = sys.argv[1]
model = whisper.load_model("base")
audio = load_audio(path)
r = model.transcribe(audio, language="ru")
print(str(r["text"]).strip())
