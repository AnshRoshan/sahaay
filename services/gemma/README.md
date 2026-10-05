# Gemma (open-source reasoning model)

Sahaay talks to any **OpenAI-compatible** endpoint, so Gemma can run fully locally:

```bash
# Ollama (easiest)
docker run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama ollama/ollama
docker exec ollama ollama pull gemma3:4b      # or gemma3:12b / gemma3:27b for better phrasing

# Sahaay .env
GEMMA_BASE_URL=http://localhost:11434
GEMMA_MODEL=gemma3:4b
```

vLLM / llama.cpp / LM Studio work the same way (`/v1/chat/completions`).

## What the model is allowed to do
- Phrase explanations and answers from structured facts.
- Classify an unclear question into one of Sahaay's intents.

## What it is NOT allowed to do
- Calculate, forecast, decide permissions, or execute actions.
- Introduce any number that isn't in the facts. `src/lib/grounding.ts` rejects such output and Sahaay falls back to the deterministic template (and records the rejection in the trace).

Because inference stays on your own machine, sales and stock data never leave your infrastructure.
