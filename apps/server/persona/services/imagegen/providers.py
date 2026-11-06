"""Image generation providers. Each returns raw image bytes (PNG/JPEG/WebP).

comfyui   ComfyUI HTTP API (built-in txt2img workflow, or an admin-supplied API workflow)
a1111     AUTOMATIC1111 / Forge  /sdapi/v1/txt2img
openai    OpenAI-compatible /images/generations (OpenAI, many proxies)
fal       fal.ai synchronous endpoint (default model fal-ai/flux/schnell)
mock      Offline gradient images (tests, demos)
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import random
from dataclasses import dataclass
from typing import Any

from persona.services.http import ProviderError, client, raise_for


@dataclass
class ImageRequest:
    prompt: str
    negative: str = ""
    n: int = 4
    width: int = 768
    height: int = 768
    seed: int | None = None


# ---------- styles ----------
STYLES: dict[str, dict[str, str]] = {
    "portrait": {
        "label": "Portrait",
        "prompt": "detailed character portrait, head and shoulders, soft studio lighting, "
        "sharp focus, high quality",
        "negative": "blurry, lowres, deformed, extra limbs, watermark, text, signature",
    },
    "anime": {
        "label": "Anime",
        "prompt": "anime style character portrait, clean lineart, vibrant colors, "
        "expressive eyes, cel shading",
        "negative": "photorealistic, 3d, lowres, blurry, watermark, text",
    },
    "painterly": {
        "label": "Painterly",
        "prompt": "digital painting, character portrait, painterly brushstrokes, rich color, "
        "dramatic lighting, artstation quality",
        "negative": "photo, lowres, blurry, watermark, text",
    },
    "realistic": {
        "label": "Photo",
        "prompt": "photorealistic portrait photograph, 85mm lens, natural light, "
        "shallow depth of field",
        "negative": "cartoon, illustration, lowres, blurry, deformed, watermark, text",
    },
    "pixel": {
        "label": "Pixel art",
        "prompt": "pixel art character portrait, 32-bit, limited palette, crisp pixels",
        "negative": "blurry, smooth gradients, photo, watermark, text",
    },
    "comic": {
        "label": "Comic",
        "prompt": "comic book style portrait, bold ink outlines, halftone shading, dynamic colors",
        "negative": "photo, lowres, blurry, watermark",
    },
}


def styled(prompt: str, style: str | None, negative: str = "") -> tuple[str, str]:
    st = STYLES.get(style or "", None)
    if not st:
        return prompt, negative
    neg = ", ".join(x for x in (negative, st["negative"]) if x)
    return f"{prompt}, {st['prompt']}", neg


# ---------- ComfyUI ----------
def comfy_default_workflow(ckpt: str, req: ImageRequest, seed: int) -> dict[str, Any]:
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": req.width, "height": req.height, "batch_size": req.n},
        },
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": req.prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": req.negative, "clip": ["4", 1]}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": 25,
                "cfg": 6.5,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "persona", "images": ["8", 0]},
        },
    }


def comfy_custom_workflow(template: str, req: ImageRequest, seed: int) -> dict[str, Any]:
    """Admin-supplied API-format workflow with %prompt% %negative% %seed% %batch% %width%
    %height% placeholders (string values are JSON-escaped)."""
    subs = {
        "%prompt%": json.dumps(req.prompt)[1:-1],
        "%negative%": json.dumps(req.negative)[1:-1],
    }
    text = template
    for k, v in subs.items():
        text = text.replace(k, v)
    for k, v in {
        "%seed%": seed,
        "%batch%": req.n,
        "%width%": req.width,
        "%height%": req.height,
    }.items():
        text = text.replace(f'"{k}"', str(v)).replace(k, str(v))
    try:
        wf = json.loads(text)
    except json.JSONDecodeError as e:
        raise ProviderError(f"ComfyUI workflow is not valid JSON: {e}") from e
    return wf.get("prompt", wf)


async def comfyui(cfg: dict[str, Any], req: ImageRequest) -> list[bytes]:
    base = (cfg.get("image_base_url") or "http://127.0.0.1:8188").rstrip("/")
    seed = req.seed if req.seed is not None else random.randint(0, 2**31 - 1)
    async with client(timeout=30) as c:
        if cfg.get("comfyui_workflow"):
            wf = comfy_custom_workflow(cfg["comfyui_workflow"], req, seed)
        else:
            ckpt = cfg.get("image_model") or ""
            if not ckpt:
                r = await c.get(f"{base}/object_info/CheckpointLoaderSimple")
                await raise_for(r, "ComfyUI")
                opts = r.json()["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
                if not opts:
                    raise ProviderError("ComfyUI has no checkpoints installed")
                ckpt = opts[0]
            wf = comfy_default_workflow(ckpt, req, seed)
        r = await c.post(f"{base}/prompt", json={"prompt": wf, "client_id": "persona"})
        await raise_for(r, "ComfyUI")
        prompt_id = r.json()["prompt_id"]

        outputs: dict[str, Any] = {}
        for _ in range(600):  # up to ~10 minutes on slow hardware
            h = await c.get(f"{base}/history/{prompt_id}")
            await raise_for(h, "ComfyUI")
            data = h.json().get(prompt_id)
            if data:
                status = data.get("status", {})
                if status.get("status_str") == "error":
                    raise ProviderError(f"ComfyUI failed: {json.dumps(status)[:300]}")
                if data.get("outputs"):
                    outputs = data["outputs"]
                    break
            await asyncio.sleep(1)
        else:
            raise ProviderError("ComfyUI timed out")

        images: list[bytes] = []
        for node in outputs.values():
            for img in node.get("images", []):
                v = await c.get(
                    f"{base}/view",
                    params={
                        "filename": img["filename"],
                        "subfolder": img.get("subfolder", ""),
                        "type": img.get("type", "output"),
                    },
                )
                await raise_for(v, "ComfyUI")
                images.append(v.content)
        if not images:
            raise ProviderError("ComfyUI returned no images (does the workflow have SaveImage?)")
        return images[: req.n]


# ---------- AUTOMATIC1111 / Forge ----------
async def a1111(cfg: dict[str, Any], req: ImageRequest) -> list[bytes]:
    base = (cfg.get("image_base_url") or "http://127.0.0.1:7860").rstrip("/")
    body: dict[str, Any] = {
        "prompt": req.prompt,
        "negative_prompt": req.negative,
        "batch_size": req.n,
        "n_iter": 1,
        "steps": 25,
        "cfg_scale": 6.5,
        "width": req.width,
        "height": req.height,
        "sampler_name": "DPM++ 2M",
        "seed": req.seed if req.seed is not None else -1,
    }
    if cfg.get("image_model"):
        body["override_settings"] = {"sd_model_checkpoint": cfg["image_model"]}
    headers = {}
    if cfg.get("image_api_key"):  # --api-auth user:pass
        headers["Authorization"] = (
            "Basic " + base64.b64encode(cfg["image_api_key"].encode()).decode()
        )
    async with client(timeout=600) as c:
        r = await c.post(f"{base}/sdapi/v1/txt2img", json=body, headers=headers)
        await raise_for(r, "AUTOMATIC1111")
        return [base64.b64decode(i.split(",", 1)[-1]) for i in r.json().get("images", [])][: req.n]


# ---------- OpenAI-compatible ----------
async def openai_images(cfg: dict[str, Any], req: ImageRequest) -> list[bytes]:
    base = (cfg.get("image_base_url") or "https://api.openai.com/v1").rstrip("/")
    model = cfg.get("image_model") or "gpt-image-1"
    headers = {"Authorization": f"Bearer {cfg.get('image_api_key', '')}"}
    prompt = req.prompt + (f". Avoid: {req.negative}" if req.negative else "")

    async def one(c) -> list[bytes]:
        body: dict[str, Any] = {"model": model, "prompt": prompt, "n": 1, "size": "1024x1024"}
        if model.startswith("dall-e"):
            body["response_format"] = "b64_json"
        r = await c.post(f"{base}/images/generations", json=body, headers=headers)
        await raise_for(r, "Image API")
        out = []
        for d in r.json().get("data", []):
            if d.get("b64_json"):
                out.append(base64.b64decode(d["b64_json"]))
            elif d.get("url"):
                img = await c.get(d["url"])
                await raise_for(img, "Image download")
                out.append(img.content)
        return out

    async with client(timeout=300) as c:
        results = await asyncio.gather(*(one(c) for _ in range(req.n)), return_exceptions=True)
    images = [img for r in results if isinstance(r, list) for img in r]
    if not images:
        err = next((r for r in results if isinstance(r, Exception)), None)
        raise ProviderError(str(err) if err else "Image API returned nothing")
    return images


# ---------- fal.ai ----------
async def fal(cfg: dict[str, Any], req: ImageRequest) -> list[bytes]:
    model = (cfg.get("image_model") or "fal-ai/flux/schnell").strip("/")
    base = (cfg.get("image_base_url") or "https://fal.run").rstrip("/")
    headers = {"Authorization": f"Key {cfg.get('image_api_key', '')}"}
    body: dict[str, Any] = {
        "prompt": req.prompt,
        "num_images": req.n,
        "image_size": "square_hd",
        "enable_safety_checker": True,
    }
    if req.negative:
        body["negative_prompt"] = req.negative
    if req.seed is not None:
        body["seed"] = req.seed
    async with client(timeout=300) as c:
        r = await c.post(f"{base}/{model}", json=body, headers=headers)
        await raise_for(r, "fal.ai")
        out = []
        for img in r.json().get("images", []):
            url = img.get("url", "")
            if url.startswith("data:"):
                out.append(base64.b64decode(url.split(",", 1)[1]))
            elif url:
                d = await c.get(url)
                await raise_for(d, "fal.ai download")
                out.append(d.content)
        return out[: req.n]


# ---------- mock ----------
async def mock(cfg: dict[str, Any], req: ImageRequest) -> list[bytes]:
    from PIL import Image, ImageDraw

    rnd = random.Random(req.seed if req.seed is not None else hash(req.prompt))
    out = []
    for _ in range(req.n):
        a = tuple(rnd.randint(30, 200) for _ in range(3))
        b = tuple(rnd.randint(30, 200) for _ in range(3))
        img = Image.new("RGB", (256, 256))
        d = ImageDraw.Draw(img)
        for y in range(256):
            t = y / 255
            d.line([(0, y), (255, y)], fill=tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3)))
        d.ellipse([78, 50, 178, 150], fill=tuple(min(255, c + 50) for c in b))
        d.rectangle([58, 170, 198, 256], fill=tuple(max(0, c - 30) for c in a))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        out.append(buf.getvalue())
    return out


PROVIDERS = {"comfyui": comfyui, "a1111": a1111, "openai": openai_images, "fal": fal, "mock": mock}


async def generate(cfg: dict[str, Any], req: ImageRequest) -> list[bytes]:
    provider = cfg.get("image_provider") or ""
    fn = PROVIDERS.get(provider)
    if fn is None:
        raise ProviderError("Image generation isn't configured on this server")
    images = await fn(cfg, req)
    if not images:
        raise ProviderError("The image provider returned no images")
    return images
