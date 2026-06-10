import requests
from src.config import settings, xinference_vice_addr, xinference_stt_model_id

url = f"{xinference_vice_addr.rstrip('/')}/v1/audio/transcriptions"
print("请求地址:", url)
print("模型:", xinference_stt_model_id)

# 用一个测试音频文件
import tempfile, wave, struct
tmp = tempfile.NamedTemporaryFile(suffix=".ma4", delete=False)
with wave.open(tmp.name, 'w') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(struct.pack('h' * 16000, *([0]*16000)))  # 1秒静音

with open(tmp.name, 'rb') as f:
    resp = requests.post(url, files={'file': f}, data={'model': xinference_stt_model_id})
print("状态码:", resp.status_code)