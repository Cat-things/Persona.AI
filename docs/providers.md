# AI providers

Everything is configured in **Admin → Providers** (or the env vars in
[configuration.md](configuration.md)). Run **Admin → Overview → Health** or `persona doctor`
after changing anything.

## Language models

Any server that speaks the OpenAI `/v1/chat/completions` API with streaming works. Pick
**OpenAI-compatible** and set the base URL:

| Server | Base URL | Notes |
|---|---|---|
| Ollama | `http://localhost:11434/v1` (Docker: `http://ollama:11434/v1`) | `ollama pull gemma3:12b` (see [models.md](models.md)) |
| LM Studio | `http://localhost:1234/v1` | Start the local server in LM Studio |
| KoboldCpp | `http://localhost:5001/v1` | |
| llama.cpp server | `http://localhost:8080/v1` | `llama-server -m model.gguf -c 8192` |
| vLLM | `http://localhost:8000/v1` | Use a different port than Persona.AI |
| OpenRouter | `https://openrouter.ai/api/v1` | API key required; model like `meta-llama/llama-3.1-70b-instruct` |
| OpenAI | `https://api.openai.com/v1` | API key required |

For **Anthropic**, choose the Anthropic provider type, paste the API key, and set the model name.

Set **Context size** to what the model actually supports; memory budgeting uses it to decide how
much history, pinned memory and summary fit. Extra models listed under "Extra models for
per-character override" become selectable in the character editor (`model|context_tokens`).
Local sampler settings (`min_p`, `top_k`, `repetition_penalty`) are sent to local servers and left
out for the official OpenAI API.

The **Demo** provider returns canned replies without any model; useful for trying the UI.

## Image generation (avatars)

| Provider | Setup |
|---|---|
| ComfyUI | Base URL `http://127.0.0.1:8188` (Docker: `http://comfyui:8188`). Model = checkpoint file name, or leave empty to use the first installed checkpoint. To use your own pipeline, export a workflow with **Save (API format)** and paste it into the `comfyui_workflow` setting with `%prompt%`, `%negative%`, `%seed%`, `%batch%`, `%width%`, `%height%` placeholders. |
| AUTOMATIC1111 / Forge | Start with `--api`. Base URL `http://127.0.0.1:7860`. For `--api-auth user:pass`, put `user:pass` in the API key field. |
| OpenAI-compatible | Base URL `https://api.openai.com/v1`, model `gpt-image-1` or `dall-e-3`. |
| fal.ai | API key from fal.ai; model defaults to `fal-ai/flux/schnell`. |

Generated images are re-encoded to WebP and stored locally; the owner gets a notification
(in-app and mobile push) when a batch finishes.

## Voices (text to speech)

| Provider | Setup | Cloning |
|---|---|---|
| Kokoro (in-process) | Native installs with `--tts`. Model files (~330 MB) download on first use. 50+ voices. | No |
| Kokoro-FastAPI (Docker `tts` profile) | Provider **OpenAI-compatible**, base URL `http://kokoro:8880/v1`. | No |
| Piper | Put `.onnx` + `.onnx.json` voices in `DATA_DIR/models/piper`; `piper` binary on PATH. | No |
| XTTS-v2 | Run the Coqui `xtts-streaming-server`; base URL e.g. `http://127.0.0.1:8020`. XTTS-v2 weights are under the Coqui Public Model License (non-commercial). | Yes |
| ElevenLabs | API key; voices are listed from your account. | Yes |
| OpenAI | Base URL `https://api.openai.com/v1`, API key. | No |

Voice cloning requires the uploader to confirm they own the recording or have the speaker's
permission. Samples are stored privately (not in the public media folder) and cloned voices are
only visible to their owner.

## Speech recognition

| Provider | Setup |
|---|---|
| faster-whisper (in-process) | Native installs with `--stt`. `STT_MODEL`: `tiny`, `base`, `small` (default), `medium`, `large-v3`. Uses CUDA when available, else CPU int8. |
| Speaches (Docker `stt` profile) | Provider **OpenAI-compatible**, base URL `http://stt:8000/v1`, model `Systran/faster-whisper-small`. |
| OpenAI Whisper API | Base URL `https://api.openai.com/v1`, model `whisper-1`, API key. |

Calls need both a voice provider and speech recognition.
