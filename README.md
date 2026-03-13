# Documentation Buddy

[![CI](https://github.com/pearsonkyle/swagger-llm-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/pearsonkyle/swagger-llm-ui/actions/workflows/ci.yml)
[![PyPI version](https://badge.fury.io/py/docbuddy.svg)](https://badge.fury.io/py/docbuddy)
[![Python versions](https://img.shields.io/pypi/pyversions/docbuddy.svg)](https://pypi.org/project/docbuddy/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Downloads](https://static.pepy.tech/badge/docbuddy)](https://pepy.tech/project/docbuddy)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)](https://fastapi.tiangolo.com/)

> Add an AI assistant to your `/docs` page.

### Try the [Standalone Demo](https://pearsonkyle.github.io/DocBuddy/)

## Installation

```bash
pip install docbuddy
```

Run the standalone page locally with the command:

```bash
docbuddy --port 9000
```

## Python Integration

```python
from fastapi import FastAPI
from docbuddy import setup_docs

app = FastAPI()
setup_docs(app)  # replaces default /docs
```

That's it! Visit `/docs`

| API Explorer | Chat Interface |
|--------------|----------------|
| ![API Explorer](examples/api.png) | ![Chat Interface with Tools](examples/tools.png) |

| Workflow Panel | LLM Settings |
|---------------|--------------|
| ![Workflow Panel](examples/workflow.png) | ![LLM Settings](examples/settings.png) |

## Features

- 💬 Chat interface with full OpenAPI context
- 🤖 LLM Settings panel with local providers (Ollama, LM Studio, vLLM, Custom)
- 🔗 Tool-calling for API Requests
- 🎨 Dark/light theme support

## Using the Chat

Ask questions like:
  - "What endpoints are available?"
  - "Create a curl cmd for adding a new user"
  - "Ping health"

Enable tool calling in the settings to allow the assistant to make API requests on your behalf.

## Standalone Mode

If you prefer manual control, run DocBuddy from the repo root:

1. Run `python3 -m http.server 8080` from the repo root
2. Visit in your browser [http://localhost:8080/docs/index.html](http://localhost:8080/docs/index.html)

> **Note:** Due to browser security restrictions (CORS), if you want to use local LLMs (Ollama, LM Studio, vLLM), you must run DocBuddy locally instead of from the GitHub Pages hosted version.

## LLM Settings

1. Choose your local LLM provider (Ollama, LM Studio, vLLM, or Custom)
2. Enter the API endpoint for your LLM (e.g. `http://localhost:1234/v1` for LMStudio)
3. Verify that the plugin can connect to your LLM provider and select a model from the drop down after.
4. Enable tool calling if you want the assistant to make API requests on your behalf.

Some local LLM providers will require users to enable CORS in their API settings to allow the plugin to connect.
![](examples/lmstudio_cors.png)

## Demo Server

```bash
uvicorn examples.demo_server:app --reload --host 0.0.0.0 --port 3333
```

## Development

```bash
pip install -e ".[dev]"

pytest tests/
pre-commit run --all-files
```
