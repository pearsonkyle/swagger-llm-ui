# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## What This Project Is

`docbuddy` is a Python package that replaces FastAPI's default `/docs` page with an LLM-enhanced Swagger UI. It injects:

1. **API Explorer** — Enhanced OpenAPI documentation viewer
2. **Chat Interface** — AI assistant for asking questions about API documentation with full OpenAPI context
3. **Workflow Panel** — Multi-step AI workflows with tool calling support
4. **LLM Settings** — Configurable settings for local LLM providers (Ollama, LM Studio, vLLM)
5. **Direct Browser-to-LLM Communication** — No server proxy required for local LLMs

Since locally-hosted LLMs support CORS, the browser talks to them directly, eliminating:
- The server proxy endpoint
- All `X-LLM-*` header machinery  
- The `httpx` dependency

Users configure LLM credentials in-browser; those are persisted in localStorage and used directly by the browser to call the LLM's `/chat/completions` endpoint.

## Installation

```bash
pip install docbuddy
```

For development:
```bash
pip install -e ".[dev]"
```

## Commands

```bash
# Run all tests
pytest tests/

# Run a single test
pytest tests/test_plugin.py::test_name -v

# Run demo server
uvicorn examples.demo_server:app --reload
```

## Architecture

### Python Backend (`src/docbuddy/`)

- **`plugin.py`** — Core plugin logic:
  - `setup_docs(app)` removes default `/docs` and `/redoc` routes, mounts static files at `/docbuddy-static`, registers custom `/docs` route (Jinja2-rendered).
  - `get_swagger_ui_html()` is the lower-level helper for custom rendering with dynamic URL injection.
  - Thread-safe via `threading.Lock` to handle concurrent app setups (prevents duplicate route registration).
  - Uses `weakref.WeakSet` to track which apps have LLM docs setup for safe cleanup.

- **`__init__.py`** — Public API exports:
  - `setup_docs(app, ...)` — Main function to set up LLM-enhanced docs
  - `get_swagger_ui_html(...)` — Lower-level HTML generation helper

### JavaScript Plugins (`src/docbuddy/static/`)

The JavaScript codebase is split into **modular files** that communicate via the `window.DocBuddy` shared namespace. No build step is required — each file is a plain ES6+ IIFE loaded via `<script>` tags in order.

#### Module Loading Order

```
docbuddy-core.js → docbuddy-chat.js, docbuddy-settings.js, docbuddy-workflow.js → docbuddy-plugin.js → llm-layout-plugin.js
```

#### `docbuddy-core.js` — Shared Utilities & State

Establishes the `window.DocBuddy` namespace with all shared code:

- **Storage helpers**: `loadFromStorage()`, `saveToStorage()`, `loadChatHistory()`, `saveChatHistory()`, `loadToolSettings()`, `saveToolSettings()`, `loadTheme()`, `saveTheme()`, `exportAsJson()`
- **OpenAPI helpers**: `buildOpenApiContext(schema)`, `buildApiRequestTool(schema)`, `ensureOpenapiSchemaCached()`
- **System prompts**: `loadSystemPromptConfig()`, `getSystemPromptForPreset(presetName, schema)`
- **State management**: Redux-like actions, reducer (`llmSettingsReducer`), selectors, `dispatchAction()`
- **Utilities**: `debounce()`, `generateMessageId()`, `copyToClipboard()`, `parseMarkdown()`, `buildCurlCommand()`
- **Components**: `createCodeBlock()`, `createSystemPromptPresetSelector()`, `buildApiMessages()`
- **Theme system**: `THEME_DEFINITIONS`, `applyLLMTheme()` (also on `window`)
- **CSS injection**: Chat/component styles injected via `injectStyles()`
- **Constants**: `LLM_PROVIDERS`, `STATUS_EMOJI`, `DEFAULT_STATE`

#### `docbuddy-chat.js` — Chat Panel

Contains `ChatPanelFactory` — the chat interface for API documentation questions with SSE streaming, tool calling, error classification, and message rendering. Reads shared utilities from `window.DocBuddy` (aliased as `DB`).

#### `docbuddy-settings.js` — Settings Panel

Contains `LLMSettingsPanelFactory` — the settings form with provider presets, connection tester, theme configuration, system prompt presets, and tool calling options.

#### `docbuddy-workflow.js` — Workflow Panel

Contains `WorkflowPanelFactory` — the multi-step AI workflow builder with block chaining, tool calling, and output display.

#### `docbuddy-plugin.js` — Plugin Assembly

~25-line file that assembles `window.LLMSettingsPlugin` from the `DocBuddy` namespace components: actions, reducer, selectors, and component factories.

#### `llm-layout-plugin.js` — Tab Navigation Layout

Wraps Swagger UI's BaseLayout with tab navigation:

**Features:**
- **4 Tabs**: API Explorer, Chat, Workflow, Settings
- **Tab Persistence**: Saves active tab to localStorage (`docbuddy-active-tab`)
- **Dynamic Height**: Chat and Settings tabs use full available height (calc(100vh - 120px))
- **API Tab Scrolling**: API tab allows normal scrolling (no overscroll containment)

**Global Functions:**
- `window.llmSwitchTab(tabName)` — Switch tabs programmatically
- `window.llmOpenSettings()` — Open settings panel from external links

### Template (`src/docbuddy/templates/`)

- **`swagger_ui.html`** — Jinja2 template that:
  - Loads Swagger UI from CDN
  - Injects theme CSS immediately (prevents FOUC)
  - Loads the 5 modular DocBuddy JS files in order (hardcoded paths to `/docbuddy-static/`)
  - Loads `llm-layout-plugin.js` last (depends on all DocBuddy components)
  - Injects JavaScript plugins in **correct order**:
    1. `SwaggerUIBundle.plugins.DownloadUrl`
    2. `LLMSettingsPlugin` (assembled by `docbuddy-plugin.js`)
    3. `LLMLayoutPlugin` (depends on LLMSettingsPanel, ChatPanel, WorkflowPanel)
  - Supports dynamic URL injection via template parameters
  - Includes DOMPurify for safe HTML sanitization

### Theme Files (`src/docbuddy/static/themes/`)

- **`dark-theme.css`** — Default theme with dark background (`#0f172a`)
- **`light-theme.css`** — Light theme option (`#f7fafc`)

## Data Flow

### Chat Interaction Flow
1. User enters prompt in Chat panel
2. JavaScript fetches OpenAPI schema from `/openapi.json`
3. System prompt built from preset + OpenAPI context
4. Messages sent to LLM `/chat/completions` endpoint via SSE
5. Streaming response displayed in real-time
6. Markdown rendered with `marked.js` + DOMPurify

### Tool Calling Flow
1. LLM responds with tool call (JSON format)
2. Chat panel displays "api_request" message
3. User can edit parameters in tool call panel
4. API call executed with configured Authorization header
5. Tool result sent back to LLM for analysis

### Workflow Flow
1. User creates blocks with prompts/instructions
2. Click "Start" to execute workflow
3. Each block's output is chained to next block as context
4. Tool calls can be executed within workflow blocks
5. All outputs are displayed with click-to-copy

## Provider Presets

Defined in `docbuddy-core.js`:
- `ollama` — `http://localhost:11434/v1`
- `lmstudio` — `http://localhost:1234/v1`
- `vllm` — `http://localhost:8000/v1`
- `custom` — User-defined URL

## Build System

- **Hatchling** (PEP 517) for packaging. Static files and templates are force-included in wheel via `pyproject.toml`.
- **pytest** with `asyncio_mode = "auto"` and anyio for async support.

## localStorage Keys

The plugin uses the following keys to persist user preferences:

| Key | Purpose |
|-----|---------|
| `docbuddy-settings` | LLM configuration (baseUrl, apiKey, modelId, maxTokens, temperature, provider) |
| `docbuddy-chat-history` | Chat conversation history (last 20 messages) |
| `docbuddy-theme` | Theme preferences (theme name + custom colors) |
| `docbuddy-active-tab` | Currently selected tab ("api", "chat", "workflow", or "settings") |
| `docbuddy-tool-settings` | Tool calling config (enableTools, autoExecute, apiKey) |
| `docbuddy-workflow` | Workflow panel block state |

**Note:** OpenAPI schema is NOT stored in localStorage to prevent quota exhaustion. It's re-fetched on each page load via `fetchOpenApiSchema()`.

## Styling & Theming System

### CSS Variables (`--theme-*`)

Both the static theme CSS files and JavaScript dynamically inject these variables into `:root`:

| Variable | Purpose |
|----------|---------|
| `--theme-primary` | Primary accent color (buttons, highlights) |
| `--theme-primary-hover` | Hover state for primary elements |
| `--theme-secondary` | Backgrounds, panels |
| `--theme-accent` | Text secondary color, borders |
| `--theme-background` | Page background |
| `--theme-panel-bg` | Panel/section backgrounds |
| `--theme-header-bg` | Header/bar backgrounds |
| `--theme-border-color` | Border colors |
| `--theme-text-primary` | Main text color |
| `--theme-text-secondary` | Secondary text color |
| `--theme-input-bg` | Input field backgrounds |

### Provider Colors

Specific to provider badges in templates:
- `--theme-provider-ollama: #2b90d8`
- `--theme-provider-vllm: #facc15`

### Theme Files

- **`themes/dark-theme.css`** — Default theme with dark background (`#0f172a`)
- **`themes/light-theme.css`** — Light theme option (`#f7fafc`)

### Dynamic Theming

The `applyLLMTheme()` function in JavaScript:
1. Merges theme defaults with custom colors
2. Updates or creates `<style id="docbuddy-theme-styles">` element
3. Applies immediately on DOM ready via `requestAnimationFrame()`
4. Template also injects initial theme to prevent FOUC

**Important for AI developers:** Theme colors should be changed through the UI's Theme Settings panel (which calls `applyLLMTheme()`), not by editing CSS files directly.

## System Prompt Presets

Defined in `system-prompt-config.json`:

| Preset | Name | Description |
|--------|------|-------------|
| `api_assistant` | API Assistant | Optimized for REST API documentation, can execute API calls via tool calling |

The `{openapi_context}` placeholder is replaced with the formatted OpenAPI schema at send time.

## Key Conventions for AI Developers

### JavaScript Code
1. **No build step** — Plain ES6+ (no JSX, no transpilation, no module bundler).
2. **IIFE pattern** — All modules wrapped in `(function () { ... })();` for scope isolation.
3. **Shared namespace** — `window.DocBuddy` is the shared namespace. Modules read from it as `var DB = window.DocBuddy;`.
4. **Global objects** — `window.LLMSettingsPlugin`, `window.LLMLayoutPlugin`, `window.applyLLMTheme`, `window.llmOpenSettings`.
5. **Browser compatibility** — Must work in modern browsers without polyfills.
6. **CDN dependencies** — marked.js and Swagger UI loaded from jsDelivr CDN, DOMPurify for security.
7. **AbortController pattern** — Use AbortController for request cancellation (streaming, tool calls).
8. **Debounce utility** — Use debounce function for connection testing to avoid rapid retries.

### CSS & Styling
1. **Theme variables first** — Use `var(--theme-*)` for all themeable colors.
2. **Scope CSS** — Prevent conflicts with `#llm-settings-panel` and `.llm-*` prefixes.
3. **Responsive design** — Include `@media (max-width: 768px)` rules for mobile.
4. **Color changes** — Update via UI Theme Settings panel, not hardcoded CSS.

### Python Backend
1. **Thread safety** — Use `_route_lock` for route modification to prevent duplicates.
2. **Weak reference tracking** — Use `weakref.WeakSet` for tracking apps to enable garbage collection.
3. **Route filtering** — Filter routes safely by creating new list, don't modify in place.
4. **CORS handling** — Client-side LLM calls work because local providers support CORS.
5. **Validation** — FastAPI dependencies use `Header(default=None)` for optional values.

### Plugin Registration Order
In `swagger_ui.html`, plugins must be registered in this order:
1. `SwaggerUIBundle.plugins.DownloadUrl`
2. `LLMSettingsPlugin` (assembled by `docbuddy-plugin.js` from `window.DocBuddy` components)
3. `LLMLayoutPlugin` (depends on LLMSettingsPanel, ChatPanel, WorkflowPanel)

The script loading order is critical:
1. `docbuddy-core.js` (creates `window.DocBuddy` namespace)
2. `docbuddy-chat.js`, `docbuddy-settings.js`, `docbuddy-workflow.js` (any order among these)
3. `docbuddy-plugin.js` (assembles `window.LLMSettingsPlugin`)
4. `llm-layout-plugin.js` (uses components from `LLMSettingsPlugin`)

Changing this order will break the UI.

### Template System
- Jinja2 used for HTML rendering.
- External JS/CSS URLs (e.g., Swagger UI CDN resources and the layout plugin URL) are injected via template parameters; internal `docbuddy-*.js` module paths are hardcoded in the template.
- `debug=True` enables auto-reload for development.
- FOUC fix: Theme injection script runs immediately in `<head>`.

## Best Practices for Contributors

### Code Quality
1. **Test first** — Add tests for new features in `tests/test_plugin.py`
2. **Update API docs** — Update README.md when functionality changes
3. **Check theme compatibility** — Test both dark and light themes
4. **Test concurrent setup** — Verify thread safety with multiple apps

### JavaScript Patterns
1. Use `var` for function-scoped variables (older pattern, compatible with all browsers)
2. Always use `AbortController` for cancellable async operations
3. **Security:** Validate all CSS color values against regex `/^#[0-9a-fA-F]{3,8}$|^rgba?\(/` before injection
4. **Security:** Always validate tool call paths start with `/` and prepend `window.location.origin`
5. **Security:** Use DOMPurify for HTML sanitization with defense-in-depth checks against `<script>` and event handler patterns
6. Use CSS variables for all themable values

### Python Patterns
1. Use `weakref.WeakSet` to avoid memory leaks from app references
2. Always use `_route_lock` when modifying routes
3. Create new route lists rather than mutating existing ones

### Version Control
- Update `version` in `pyproject.toml` for releases
- Update `__version__` in `src/docbuddy/__init__.py`
- Follow semantic versioning (MAJOR.MINOR.PATCH)

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/docbuddy/__init__.py` | Public API exports |
| `src/docbuddy/plugin.py` | Core Python plugin logic |
| `src/docbuddy/static/docbuddy-core.js` | Shared namespace, utilities, state, storage, OpenAPI helpers |
| `src/docbuddy/static/docbuddy-chat.js` | ChatPanel component |
| `src/docbuddy/static/docbuddy-settings.js` | LLMSettingsPanel component |
| `src/docbuddy/static/docbuddy-workflow.js` | WorkflowPanel component |
| `src/docbuddy/static/docbuddy-plugin.js` | Plugin assembly (combines namespace into LLMSettingsPlugin) |
| `src/docbuddy/static/llm-layout-plugin.js` | Tab navigation layout |
| `src/docbuddy/templates/swagger_ui.html` | Jinja2 template for docs page |
| `src/docbuddy/static/system-prompt-config.json` | System prompt presets configuration |
| `examples/demo_server.py` | Demo FastAPI server with sample endpoints |

## Testing Guidelines

Run tests with:
```bash
pytest tests/ -v
```

Key test categories:
- Route setup and HTML generation
- Static file serving
- Provider preset configuration
- JavaScript function existence
- Thread safety and concurrent setup
- Theme injection and FOUC prevention
- LocalStorage key naming
- Tool calling functionality

## Troubleshooting

### CORS Issues
Local LLM providers must support CORS. For LM Studio, enable "Allow requests from anywhere" in Settings > Advanced.

### Theme Not Applying
Check that theme CSS file is being served from `/docbuddy-static/themes/` and that JavaScript `applyLLMTheme()` is called.

### Connection Test Fails
Verify:
1. LLM provider is running and accessible
2. Base URL is correct (includes `/v1` suffix)
3. API key is valid (if required by provider)

### Chat Response Empty
Check browser console for streaming errors. Verify `/chat/completions` endpoint is accessible and returns valid SSE format.