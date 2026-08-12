# Voice Agent Setup

The voice module requires two local binaries: **whisper.cpp** (STT) and **Piper** (TTS).  
No cloud API keys are needed.

## 1. whisper.cpp

### Build

```bash
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
make
```

Download a model (base English recommended for low latency):

```bash
bash models/download-ggml-model.sh base.en
# → models/ggml-base.en.bin
```

### Build (uses CMake — install cmake first if needed)

```bash
# cmake binary install without sudo (Linux x86_64):
wget -q -O /tmp/cmake.tar.gz https://github.com/Kitware/CMake/releases/download/v3.31.8/cmake-3.31.8-linux-x86_64.tar.gz
mkdir -p ~/.local/cmake && tar -xzf /tmp/cmake.tar.gz -C ~/.local/cmake --strip-components=1
export PATH="$HOME/.local/cmake/bin:$PATH"   # add to ~/.bashrc for persistence

cd ~/.local/opt/whisper.cpp/repo
cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF
cmake --build build --config Release -j$(nproc)
# binary produced at: build/bin/whisper-cli
```

### Environment

```env
VOICE_WHISPER_BIN=/home/<user>/.local/opt/whisper.cpp/repo/build/bin/whisper-cli
VOICE_WHISPER_MODEL=/home/<user>/.local/opt/whisper.cpp/repo/models/ggml-base.en.bin
```

## 2. Piper

### Install (Linux x86_64)

```bash
mkdir -p ~/.local/opt/piper ~/.local/opt/piper/voices

# Binary (pre-built, no compilation needed)
wget -O /tmp/piper.tar.gz \
  https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
tar -xzf /tmp/piper.tar.gz -C ~/.local/opt/piper/
# binary at: ~/.local/opt/piper/piper/piper

# Voice model: en_US-lessac-medium (~61 MB)
wget -O ~/.local/opt/piper/voices/en_US-lessac-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
wget -O ~/.local/opt/piper/voices/en_US-lessac-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

### Environment

```env
VOICE_PIPER_BIN=/home/<user>/.local/opt/piper/piper/piper
VOICE_PIPER_MODEL=/home/<user>/.local/opt/piper/voices/en_US-lessac-medium.onnx
```

## 3. Optional settings

```env
VOICE_ENABLED=true            # set to false to disable the /voice gateway
VOICE_SAMPLE_RATE=16000       # PCM sample rate the client must send
VOICE_SILENCE_DURATION_MS=1200  # silence gap before auto-committing an utterance
```

## 4. Verification

On server boot, `VoiceModelCheckService` validates every path and logs clearly:

```
✅  whisper.cpp binary OK: /home/ayman/.local/opt/whisper.cpp/repo/build/bin/whisper-cli
✅  whisper.cpp model OK:  ggml-base.en.bin
✅  Piper binary OK:       /home/ayman/.local/opt/piper/piper/piper
✅  Piper model OK:        en_US-lessac-medium.onnx
Voice model check passed — whisper.cpp + Piper ready.
```

If a path is wrong you get a structured error message with the exact fix command — the server does not crash.
