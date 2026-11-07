# Choosing models

Persona.AI works with any OpenAI-compatible or Anthropic chat model and with several image
backends. This page explains the defaults the installer picks and how to change them.

## Why these defaults

Character.AI runs its own models, which are closed. Its engineers have described them
publicly: dense transformers built to serve cheaply, then supervised fine-tuning and
learning from user feedback for safety and alignment. The weights aren't published, so no
self-hosted app can use them.

Persona.AI takes the same approach with open models. It starts from an official instruct model
that already has safety tuning, then lets you fine-tune it on your own instance's rated chats
(see [Training your own model](#training-your-own-model)).

Each default meets three rules:

- **Safety-tuned by the publisher.** Every default is an official instruct release from
  Google or Meta, not a community "uncensored" or "NSFW" roleplay finetune. Those finetunes
  are often stronger at roleplay, but many have had their refusals trained out. On a server
  you share, they aren't a safe default.
- **Safe file formats.** Chat models are GGUF, pulled from the Ollama library. Image models
  are `.safetensors`, downloaded from Hugging Face. Neither format can run code when it loads,
  unlike pickled `.ckpt`/`.bin` files. The installer also checks each image checkpoint's
  SHA-256 hash and deletes the file if the hash doesn't match.
- **Persona.AI's content filter stays on** in front of every model. It is on by default and
  its child-safety rule can't be turned off.

## Chat models (Ollama)

The installer picks a model based on your GPU memory, or on two thirds of system RAM on Apple
Silicon:

| Memory | Default | Size | Notes |
|---|---|---|---|
| 20 GB+ | `gemma3:27b` | ~17 GB | Best quality of the defaults; strong at staying in character |
| 10 GB+ | `gemma3:12b` | ~8 GB | Good balance for one GPU |
| 6 GB+, or CPU with 12 GB+ RAM | `llama3.1:8b` | ~5 GB | Fast, widely tested |
| smaller | `gemma3:4b` | ~3 GB | Laptops and small servers |

To use a different model, pass `--model NAME` to the installer, or set the model in
**Admin → Providers**. You can also override it per character in the character editor's
advanced settings. Other official instruct models work well too, for example
`mistral-small3.2:24b` and `qwen3:14b`.

Licences: Gemma models use the [Gemma Terms of Use](https://ai.google.dev/gemma/terms), and
Llama 3.x models use the Llama Community Licence. Both allow self-hosting, and both come with
an acceptable-use policy.

### Cloud models

With `--llm external`, any OpenAI-compatible API works: OpenRouter, OpenAI, Together, Groq and
others. Set `LLM_PROVIDER=anthropic` to use Claude. All of these providers apply their own safety
systems on top of Persona.AI's filter.

### Community roleplay finetunes

Admins can still choose a community model, for example in Ollama as
`hf.co/<user>/<repo>-GGUF:Q4_K_M`. Before doing that on a shared instance:

- read the model card, especially what it says about refusals and explicit content;
- keep the content filter on (**Admin → Content**);
- prefer GGUF or safetensors files from well-known quantizers;
- check the licence, since many finetunes are non-commercial (CC BY-NC).

## Image models (avatars)

When you enable ComfyUI and accept the starter model, the installer downloads one of these:

| GPU | Model | Size | Settings Persona.AI uses |
|---|---|---|---|
| 10 GB+ VRAM | DreamShaper XL Lightning **SFW** | 6.9 GB | 1024 px, 6 steps, CFG 2, DPM++ SDE Karras |
| smaller GPUs, CPU | DreamShaper 8 (SD 1.5) | 2.1 GB | 768 px, 25 steps, CFG 6.5, DPM++ 2M Karras |

To choose one yourself, pass `--checkpoint-model sdxl` or `--checkpoint-model sd15`.

The SFW build of DreamShaper XL is tuned to avoid explicit output. Both models are general
purpose, so they handle realistic, anime, painterly and 3D styles through the avatar style
presets. Persona.AI reads the checkpoint name to pick sampler settings: names containing
`lightning` or `turbo` get few-step settings, and names containing `xl` render at 1024 px.

Pinned files and their SHA-256 hashes:

```
DreamShaperXL_Lightning-SFW.safetensors  832e7bb2302c3cd67c818ca4fe9dcbedf696d3070dab5463127263ec4db9899f
DreamShaper_8_pruned.safetensors         879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd
```

Anime-focused SDXL models such as Illustrious XL are popular for avatars. They also produce
explicit images readily, so they aren't defaults. If you install one, keep the content filter on.

## Training your own model

You can fine-tune a model on your own instance's chats. Users opt in, star ratings decide what
the model learns from, and a LoRA fine-tune turns the result into an Ollama model. The full
guide is [training/README.md](../training/README.md).
