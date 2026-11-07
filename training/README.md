# Train your own chat model

This folder turns your instance's best conversations into a fine-tuned chat model. The result
is a LoRA fine-tune of an open base model, exported to GGUF and loaded into Ollama.

The process has three steps:

```
persona export-training   ->  sft.jsonl + dpo.jsonl   (on the server)
python train.py           ->  LoRA + GGUF + Modelfile (on a GPU machine)
ollama create persona-rp  ->  pick "persona-rp" in Admin -> Providers
```

## What the model learns from

- **Opted-in users only.** Each user decides in **Settings → Help train this instance's model**.
  The setting is off by default, and without opted-in users the export is empty.
- **Star ratings decide.** Replies rated 3 or 4 stars are learned from (change this with
  `--min-rating`). Unrated and low-rated replies stay in as context only: their loss is masked,
  so the model never learns to write them. Character greetings were written by the creator,
  not the model, so they're always treated as context.
- **Swipes become preferences.** When one reply has several swipes and the user rated them at
  least 2 stars apart, the export writes a chosen/rejected pair to `dpo.jsonl`. The optional
  DPO pass (`--dpo`) uses these pairs to teach the model what users preferred.
- **Same prompt as serving.** Each conversation starts with the exact system prompt the server
  sends at inference time: character card, example dialogs and safety guard. The model learns
  the format it will actually be used with.

## Safety and privacy

- Every message is checked by the content filter with **all** categories switched on: explicit
  sexual content, graphic violence and self-harm encouragement, plus the always-on child-safety
  rule. This applies even if your instance relaxes the filter for chatting. One flagged message
  drops the whole conversation, so a trained model doesn't pick up content your filter blocks.
- Emails, phone numbers and links become `[email]`, `[number]` and `[link]`. The user's
  username, display name and persona names become `User`.
- Room (group) chats are skipped. So are characters that are private and belong to someone
  else, and characters an admin removed.
- The base models below are safety-tuned. A small LoRA on filtered data keeps that behaviour.
  Don't add data designed to remove refusals.
- `sft.jsonl` still contains private conversations. Keep it on machines you control, delete it
  after training, and don't publish the dataset or a model trained on it.

## 1. Export the data

The export runs on the server.

```bash
./install.sh export-training --out ~/training-data      # Docker or native install
# from a source checkout instead:
cd apps/server && uv run persona export-training --out training-data
```

Only you can read the exported folder. The underlying command also accepts `--min-rating 1-4`
(default 3) and `--include-unrated`.

It prints how many conversations, learned replies and preference pairs it wrote, and how many
it dropped. For a noticeable improvement, aim for **at least several hundred rated
conversations**. `train.py` refuses to run with fewer than 50 conversations, because very small
datasets overfit and make the model worse.

### Adding public datasets

You can mix in public roleplay datasets. Many popular ones (PIPPA, LimaRP, Bluemoon) contain a
lot of explicit content, so always run them through the same strict filter first:

```bash
persona filter-jsonl downloaded.jsonl filtered.jsonl
cat filtered.jsonl >> training-data/sft.jsonl
```

The filter accepts OpenAI-style `messages` or ShareGPT `conversations` rows. Check each
dataset's licence before using it.

## 2. Train

Training needs an NVIDIA GPU. Use any machine you own, or a rented cloud GPU. The training
environment is separate from the server.

Run `nvidia-smi` first to see your card, its VRAM and the driver version. Then install the
PyTorch build that matches your card:

| GPU | PyTorch index | Driver needed |
|---|---|---|
| RTX 50 series (Blackwell: 5050, 5060, 5070, 5080, 5090) | `cu128` (required) | 570 or newer |
| RTX 20, 30 and 40 series, A100, H100 | `cu128` or `cu126` | 560 or newer |

Older cards (GTX 10 series and earlier) aren't supported by current PyTorch builds.

Use Python 3.12. Rolling-release distros such as Arch, EndeavourOS and Fedora often ship a
newer Python, and Unsloth may not have wheels for it yet. uv can download 3.12 for you:

```bash
cd training
uv venv --python 3.12 .venv && . .venv/bin/activate
uv pip install torch --index-url https://download.pytorch.org/whl/cu128
uv pip install -r requirements.txt
python -c "import torch; print(torch.cuda.get_device_name(0))"   # should print your GPU

python train.py --data training-data --out my-model            # SFT
python train.py --data training-data --out my-model --dpo      # SFT, then DPO
```

Plain `python -m venv` and `pip` work too, as long as the interpreter is 3.12.

| Base (`--base`) | VRAM for 4-bit LoRA | Licence |
|---|---|---|
| `unsloth/Llama-3.2-3B-Instruct` | ~5 GB | Llama 3.2 Community |
| `unsloth/Llama-3.1-8B-Instruct` (default) | ~8 GB | Llama 3.1 Community |
| `unsloth/Qwen3-8B` | ~8 GB | Apache-2.0 |
| `unsloth/gemma-3-12b-it` | ~14 GB | Gemma Terms of Use |

On an **8 GB card** that also runs your desktop (for example an RTX 5050, 4060 or 3070), part
of the VRAM is already in use. Either start with the 3B model, or train the 8B model with
shorter sequences and a batch size of 1:

```bash
python train.py --data training-data --out my-model --base unsloth/Llama-3.2-3B-Instruct
python train.py --data training-data --out my-model --max-len 2048 --batch 1 --grad-accum 16
```

If you see `CUDA out of memory`, close GPU-heavy apps (browsers and games use VRAM), stop
Ollama while training (`systemctl stop ollama`, or `docker compose stop ollama`), then lower
`--max-len`. Training also needs free system RAM: plan on 12 GB or more for an 8B model,
and about 8 GB for 3B.

The default settings are rank-16 LoRA, two epochs, learning rate 1e-4, cosine schedule and
4,096-token sequences. `train.py` drops the oldest turns of long chats, never the system
prompt. It holds back 5% of conversations to measure eval loss each epoch. If eval loss rises
while train loss keeps falling, the model is overfitting: train fewer epochs or collect more
data.

Training an 8B model on a few thousand conversations takes roughly 30 to 90 minutes on a
single RTX 4090-class GPU.

## 3. Use it

```bash
cd my-model
ollama create persona-rp -f Modelfile
```

Then add `persona-rp` in **Admin → Providers**, either as the default model or as an extra
model to switch to per character. Test it on a few of your characters before making it the
default. A/B comparison is easy: give one character the new model and compare star ratings.

## Doing it again

The cycle repeats: users rate replies, you export, train and compare. Keep the previous model
in Ollama until the new one rates at least as well.
