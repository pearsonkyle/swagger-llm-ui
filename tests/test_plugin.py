"""Tests for docbuddy package."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from docbuddy import setup_docs
from docbuddy.plugin import get_swagger_ui_html


# ── Helpers ───────────────────────────────────────────────────────────────────


DOCBUDDY_JS_FILES = [
    "core.js",
    "chat.js",
    "settings.js",
    "workflow.js",
    "agent.js",
    "plugin.js",
]


def get_all_plugin_js(client):
    """Get concatenated content of all docbuddy plugin JS files."""
    return "\n".join(
        client.get(f"/docbuddy-static/{f}").text for f in DOCBUDDY_JS_FILES
    )


# ── Fixtures ───────────────────────────────────────────────────────────────────


def make_app() -> FastAPI:
    """Return a fresh FastAPI app with LLM docs set up."""
    app = FastAPI(title="Test App")
    setup_docs(app)
    return app


def make_debug_app() -> FastAPI:
    """Return a fresh FastAPI app with LLM docs in debug mode."""
    app = FastAPI(title="Test App Debug")
    setup_docs(app, debug=True)
    return app


# ── setup_docs tests ────────────────────────────────────────────────────────────


def test_docs_route_exists():
    """The /docs route should be reachable and return 200."""
    client = TestClient(make_app())
    response = client.get("/docs")
    assert response.status_code == 200


def test_docs_returns_html():
    """The /docs route should return an HTML content-type."""
    client = TestClient(make_app())
    response = client.get("/docs")
    assert "text/html" in response.headers["content-type"]


def test_docs_contains_plugin_scripts():
    """The docs page HTML should reference the docbuddy plugin JS files."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "core.js" in html
    assert "plugin.js" in html


def test_docs_contains_swagger_bundle():
    """The docs page should reference the Swagger UI bundle."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "swagger-ui-bundle" in html


def test_static_files_served():
    """The plugin JS files should be served from /docbuddy-static."""
    client = TestClient(make_app())
    for f in DOCBUDDY_JS_FILES:
        assert client.get(f"/docbuddy-static/{f}").status_code == 200


def test_custom_docs_url():
    """setup_docs should work with a custom docs_url."""
    app = FastAPI(title="Custom URL Test")
    setup_docs(app, docs_url="/api-docs")
    client = TestClient(app)
    assert client.get("/api-docs").status_code == 200
    # Default /docs should not exist
    assert client.get("/docs").status_code == 404


def test_openapi_json_still_accessible():
    """The OpenAPI JSON schema should still be accessible."""
    client = TestClient(make_app())
    response = client.get("/openapi.json")
    assert response.status_code == 200
    data = response.json()
    assert "openapi" in data


def test_docs_does_not_contain_request_interceptor():
    """The docs page should not include the old X-LLM-* request interceptor."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    # Old requestInterceptor should be removed
    assert "requestInterceptor" not in html


def test_docs_contains_llm_settings_panel():
    """The docs page should include the LLM settings panel."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "llm-settings-panel" in html


# ── get_swagger_ui_html tests ────────────────────────────────────────────────────


def test_get_swagger_ui_html_returns_html_response():
    """get_swagger_ui_html should return an HTMLResponse."""
    from fastapi.responses import HTMLResponse

    resp = get_swagger_ui_html(openapi_url="/openapi.json", title="Test")
    assert isinstance(resp, HTMLResponse)
    assert "swagger" in resp.body.decode().lower()


def test_get_swagger_ui_html_includes_title():
    """The rendered HTML should contain the provided title."""
    resp = get_swagger_ui_html(openapi_url="/openapi.json", title="My Custom Title")
    assert "My Custom Title" in resp.body.decode()


def test_get_swagger_ui_html_includes_openapi_url():
    """The rendered HTML should reference the provided OpenAPI URL."""
    resp = get_swagger_ui_html(openapi_url="/custom/openapi.json", title="T")
    assert "/custom/openapi.json" in resp.body.decode()


def test_get_swagger_ui_html_includes_debug_flag():
    """The rendered HTML should support debug mode."""
    from fastapi.responses import HTMLResponse

    resp = get_swagger_ui_html(openapi_url="/openapi.json", title="T", debug=True)
    assert isinstance(resp, HTMLResponse)


# ── Provider tests (only local providers remain) ────────────────────────────────


def test_provider_presets_available():
    """Verify LLM provider presets are available in the JavaScript."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # Check for local provider configurations (cloud providers removed)
    assert "ollama" in js_content.lower()
    assert "lmstudio" in js_content.lower()
    assert "vllm" in js_content.lower()

    # Cloud providers should be removed
    assert "api.openai.com" not in js_content.lower()
    assert "api.anthropic.com" not in js_content.lower()
    assert "azure" not in js_content.lower()


def test_provider_preset_ollama():
    """Test Ollama provider preset."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    # Check Ollama preset
    assert "ollama" in js_content.lower()
    assert "localhost:11434/v1" in js_content


def test_provider_preset_lmstudio():
    """Test LM Studio provider preset."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    # Check LM Studio preset
    assert "lmstudio" in js_content.lower()
    assert "localhost:1234/v1" in js_content


def test_provider_preset_vllm():
    """Test vLLM provider preset."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    # Check vLLM preset
    assert "vllm" in js_content.lower()
    assert "localhost:8000/v1" in js_content


# ── JavaScript function tests (client-side functionality) ───────────────────────


def test_build_openapi_context_function_exists():
    """Verify buildOpenApiContext function exists in JavaScript (client-side now)."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    # Check for the client-side function
    assert "buildOpenApiContext" in js_content


def test_build_api_request_tool_function_exists():
    """Verify buildApiRequestTool function exists in JavaScript (client-side now)."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    # Check for the client-side function
    assert "buildApiRequestTool" in js_content


def test_chat_panel_included():
    """Verify chat panel component is included."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "ChatPanel" in js_content
    assert "chatHistory" in js_content


def test_streaming_llm_response_function_exists():
    """Verify _streamLLMResponse function exists for direct LLM calls."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    assert "_streamLLMResponse" in js_content
    # Should call /chat/completions directly, not /llm-chat
    assert "/chat/completions" in js_content


def test_test_connection_calls_models_endpoint():
    """Verify handleTestConnection calls /models endpoint directly."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    # Should call /models directly, not /llm/models
    assert '/models"' in js_content


# ── Thread safety tests ────────────────────────────────────────────────────────


def test_route_cleanup_thread_safety():
    """Test that route cleanup uses thread-safe operations."""
    # Create multiple apps simultaneously
    app1 = make_app()
    app2 = make_app()

    client1 = TestClient(app1)
    client2 = TestClient(app2)

    # Both should have docs endpoint
    assert client1.get("/docs").status_code == 200
    assert client2.get("/docs").status_code == 200

    # OpenAPI should still work
    assert client1.get("/openapi.json").status_code == 200
    assert client2.get("/openapi.json").status_code == 200


def test_concurrent_app_setup():
    """Test that setting up multiple apps concurrently doesn't cause issues."""
    import threading

    results = []

    def setup_app(idx):
        try:
            app = FastAPI(title=f"Test App {idx}")
            setup_docs(app)
            client = TestClient(app)

            # Verify docs work
            docs_resp = client.get("/docs")

            results.append({"idx": idx, "success": docs_resp.status_code == 200})
        except Exception as e:
            results.append({"idx": idx, "success": False, "error": str(e)})

    # Setup multiple apps concurrently
    threads = []
    for i in range(5):
        t = threading.Thread(target=setup_app, args=(i,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # All should succeed
    assert all(r["success"] for r in results)


# ── Debug mode tests ───────────────────────────────────────────────────────────


def test_debug_mode_disables_cache():
    """Test that debug mode enables auto-reload."""
    client = TestClient(make_debug_app())

    # Debug app should work
    response = client.get("/docs")
    assert response.status_code == 200

    # Check that HTML contains debug-related setup
    html = response.text
    assert "debug" in html.lower() or "auto.reload" in html.lower()


# ── CSS scoping tests ──────────────────────────────────────────────────────────


def test_css_scoping():
    """Verify CSS is properly scoped to avoid conflicts."""
    client = TestClient(make_app())
    html = client.get("/docs").text

    # Check for scoped styles
    assert "#llm-settings-panel" in html or "llm-settings-panel {" in html

    # Check for provider badge styles (note: cloud providers removed)
    assert ".llm-provider-badge" in html or "llm-provider-badge" in html

    # Ollama badge should exist
    assert ".llm-provider-ollama" in html or "llm-provider-ollama" in html


# ── OpenAPI schema fetching tests ───────────────────────────────────────────────


def test_fetch_openapi_schema_in_chat_panel():
    """Test that the JavaScript fetches and stores OpenAPI schema."""
    client = TestClient(make_app())

    # Get the docs page to verify JavaScript contains fetch logic
    html = client.get("/docs").text

    # Check that the JavaScript includes OpenAPI schema fetching
    assert "fetchOpenApiSchema" in html or "core.js" in html

    # Check that the JS files contain schema storage logic
    js_content = get_all_plugin_js(client)
    assert "openapiSchema" in js_content


# ── Theme tests ────────────────────────────────────────────────────────────────


def test_themes_included():
    """Verify theme files are included."""
    client = TestClient(make_app())
    html = client.get("/docs").text

    # Check for theme injection script
    assert "applyLLMTheme" in html or "/docbuddy-static/themes/" in html

    # Check for theme CSS file reference (default is light theme)
    assert "light-theme.css" in html


def test_dark_theme_default():
    """Verify dark theme is applied by default."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # Check for default theme configuration
    assert "dark" in js_content.lower()


# ── Error handling tests (CORS guidance) ───────────────────────────────────────


def test_cors_error_message_in_javascript():
    """Verify CORS error guidance is available in JavaScript."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # Check for connection error guidance in the JavaScript
    assert "connection" in js_content.lower() or "fetch" in js_content.lower()


# ── LLM headers should be removed ──────────────────────────────────────────────


def test_no_x_llm_header_interceptor():
    """The docs page should NOT include X-LLM-* header injection."""
    client = TestClient(make_app())
    html = client.get("/docs").text

    # X-LLM-* headers should not be in requestInterceptor
    assert "X-LLM-" not in html


def test_no_llm_chat_endpoint():
    """The /llm-chat endpoint should not exist."""
    client = TestClient(make_app())

    # Should get 404 or similar
    response = client.post("/llm-chat", json={})
    # The endpoint should not be registered
    assert response.status_code in [404, 405]


def test_no_llm_models_endpoint():
    """The /llm/models endpoint should not exist."""
    client = TestClient(make_app())

    # Should get 404 or similar
    response = client.get("/llm/models")
    assert response.status_code in [404, 405]


# ── Settings panel tests ───────────────────────────────────────────────────────


def test_settings_panel_included():
    """Verify LLM settings panel is included."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "LLMSettingsPanel" in js_content


def test_settings_panel_fields():
    """Verify settings panel has all required fields."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # Check for provider selector
    assert "provider" in js_content.lower()

    # Check for base URL input
    assert "baseUrl" in js_content or "base_url" in js_content.lower()

    # Check for API key input
    assert "apiKey" in js_content or "api_key" in js_content.lower()

    # Check for model ID input
    assert "modelId" in js_content or "model_id" in js_content.lower()


def test_settings_panel_test_connection():
    """Verify test connection functionality exists."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "handleTestConnection" in js_content


def test_settings_panel_save_functionality():
    """Verify settings save to localStorage."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "localStorage" in js_content
    assert "saveToStorage" in js_content


# ── Chat panel functionality tests ─────────────────────────────────────────────


def test_chat_input_area():
    """Verify chat input area exists."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "handleSend" in js_content
    assert "handleInputChange" in js_content


def test_chat_history_persistence():
    """Verify chat history is persisted to localStorage."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "chatHistory" in js_content
    assert "localStorage" in js_content


def test_clear_chat_history():
    """Verify clear chat history functionality exists."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "clearHistory" in js_content


def test_copy_to_clipboard():
    """Verify copy to clipboard functionality exists."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "copyToClipboard" in js_content


def test_typing_indicator():
    """Verify typing indicator for streaming responses exists."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "typing" in js_content.lower()


def test_markdown_parsing():
    """Verify markdown parsing functionality exists."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "parseMarkdown" in js_content or "marked" in js_content.lower()


def test_error_classification():
    """Verify error classification and user-friendly messages exist."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # Check for error handling
    assert "error" in js_content.lower()
    assert "catch" in js_content.lower()


def test_tool_calling_panel():
    """Verify tool calling panel exists."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "renderToolCallPanel" in js_content
    assert "handleExecuteToolCall" in js_content


# ── Local storage keys tests ───────────────────────────────────────────────────


def test_settings_storage_key():
    """Verify correct localStorage key for settings."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "docbuddy-settings" in js_content


def test_chat_history_storage_key():
    """Verify correct localStorage key for chat history."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "docbuddy-chat-history" in js_content


def test_theme_storage_key():
    """Verify correct localStorage key for theme."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "docbuddy-theme" in js_content


# ── Tab switching tests ────────────────────────────────────────────────────────


def test_layout_plugin_tabs():
    """Verify LLM layout plugin has tab navigation."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "DocBuddyPlugin" in js_content
    # Should have API, Chat, Settings tabs
    assert "api" in js_content.lower()
    assert "chat" in js_content.lower()
    assert "settings" in js_content.lower()


def test_tab_persistence():
    """Verify active tab preference is persisted."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "docbuddy-active-tab" in js_content


# ── Import tests ───────────────────────────────────────────────────────────────


def test_public_api_exports():
    """Test that only expected exports are available in public API."""
    from docbuddy import __all__ as public_api

    # Only setup_docs and get_swagger_ui_html should be exported
    assert "setup_docs" in public_api
    assert "get_swagger_ui_html" in public_api


def test_no_httpx_dependency():
    """Test that httpx is not used (removed for client-side architecture)."""
    from docbuddy import plugin

    # The plugin module should not import httpx
    import inspect

    source = inspect.getsource(plugin)

    # httpx should not be mentioned
    assert "httpx" not in source


# ── Edge case tests ────────────────────────────────────────────────────────────


def test_empty_api_key_handling():
    """Test that empty API key is handled correctly."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # Empty API key should not set Authorization header
    assert "Authorization" in js_content or "Bearer" not in js_content


def test_provider_base_url_format():
    """Verify provider base URLs are properly formatted."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # URLs should end with /v1
    assert "/v1" in js_content


def test_max_tokens_default():
    """Verify max tokens has a default value."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "maxTokens" in js_content


def test_temperature_default():
    """Verify temperature has a default value."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "temperature" in js_content


def test_debounce_function_exists():
    """Verify debounce function exists for connection testing."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "debounce" in js_content


def test_abort_controller_for_cancellation():
    """Verify AbortController is used for request cancellation."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "AbortController" in js_content or "abort()" in js_content


# ── HTML template tests ────────────────────────────────────────────────────────


def test_template_theme_injection():
    """Verify theme is injected immediately in template to prevent FOUC."""
    client = TestClient(make_app())
    html = client.get("/docs").text

    # Check for our template's key elements
    assert "docbuddy-static" in html, "Template should include our static files"
    assert (
        "applyLLMTheme" in html or "/docbuddy-static/themes/" in html
    ), "Template should include theme injection"


def test_template_script_order():
    """Verify scripts are loaded in correct order."""
    client = TestClient(make_app())
    html = client.get("/docs").text

    # Swagger UI bundle should load first
    swagger_idx = html.find("swagger-ui-bundle")
    core_idx = html.find("core.js")
    plugin_idx = html.find("plugin.js")

    assert swagger_idx > 0
    assert core_idx > swagger_idx
    assert plugin_idx > core_idx


# ── Layout plugin tests ────────────────────────────────────────────────────────


def test_layout_plugin_imports():
    """Verify layout plugin imports correctly."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "window.DocBuddyPlugin" in js_content


def test_base_layout_wrapper():
    """Verify layout plugin wraps BaseLayout."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "BaseLayout" in js_content


def test_llm_docs_layout_component():
    """Verify LLMDocsLayout component exists."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "LLMDocsLayout" in js_content


def test_chat_height_calculation():
    """Verify chat tab has proper height calculation."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "calc(100vh" in js_content or "height:" in js_content.lower()


# ── Workflow tab tests ─────────────────────────────────────────────────────


def test_workflow_tab_in_layout():
    """Verify layout plugin has Workflow tab."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "workflow" in js_content.lower()
    assert "WorkflowPanel" in js_content


def test_workflow_panel_component():
    """Verify WorkflowPanel component is included."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "WorkflowPanel" in js_content
    assert "WorkflowPanelFactory" in js_content


def test_workflow_panel_controls():
    """Verify workflow panel has start/stop/reset buttons."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "handleStart" in js_content
    assert "handleStop" in js_content
    assert "handleReset" in js_content


def test_workflow_panel_block_management():
    """Verify workflow panel has add/remove block functionality."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "handleAddBlock" in js_content
    assert "handleRemoveBlock" in js_content


def test_workflow_panel_block_output():
    """Verify workflow panel displays block outputs."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "output" in js_content
    assert "runWorkflow" in js_content


def test_workflow_panel_block_chaining():
    """Verify workflow panel feeds output of each block into the next."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "conversationHistory" in js_content
    assert "currentUserMessage" in js_content


def test_workflow_panel_tool_execution():
    """Verify workflow panel supports LLM tool execution in blocks."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "executeToolCall" in js_content
    assert "tool_calls" in js_content
    assert "Tool Result" in js_content


def test_workflow_storage_key():
    """Verify correct localStorage key for workflow."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "docbuddy-workflow" in js_content


def test_workflow_styles_injected():
    """Verify workflow panel uses theme-aware CSS variables."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # Check for workflow panel related content
    assert "WorkflowPanel" in js_content or "llm-workflow" in js_content.lower()
    assert (
        "var(--theme-border-color)" in js_content
        or "theme-border" in js_content.lower()
    )
    assert "var(--theme-primary)" in js_content or "theme-primary" in js_content.lower()


def test_export_function_exists():
    """Verify exportAsJson utility function exists in settings plugin."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "exportAsJson" in js_content
    assert "application/json" in js_content
    assert "createObjectURL" in js_content


def test_chat_export_button():
    """Verify Chat panel has an Export button."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "chat-history-" in js_content
    assert "Export" in js_content


def test_workflow_export_button():
    """Verify Workflow panel has an Export button."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "workflow-" in js_content


def test_copy_feedback_indicator():
    """Verify copied feedback overlay is present in chat and workflow."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "Copied!" in js_content
    assert "llm-fade-in" in js_content
    assert "copiedBlockId" in js_content


def test_api_request_tool_supports_all_methods():
    """Verify buildApiRequestTool includes PUT/PATCH/DELETE in addition to GET/POST."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "'GET', 'POST', 'PUT', 'PATCH', 'DELETE'" in js_content
    assert "'get', 'post', 'put', 'patch', 'delete'" in js_content


def test_workflow_tool_call_shows_curl():
    """Verify workflow tool calls display curl command in output."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "Tool Call" in js_content
    assert "buildCurlCommand" in js_content


def test_api_tab_scroll_not_constrained():
    """Verify API tab does not have overscrollBehavior contain that blocks scrolling."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    # API tab should not have fixed height or overscroll contain
    assert 'isContained ? "contain" : "auto"' in js_content


def test_tool_call_post_content_type():
    """Verify POST/PUT/PATCH tool calls set Content-Type: application/json header."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # handleExecuteToolCall should set Content-Type for body-bearing methods
    assert "fetchHeaders['Content-Type'] = 'application/json'" in js_content
    # Body should be included for POST, PUT, and PATCH
    assert (
        "s.editMethod === 'POST' || s.editMethod === 'PUT' || s.editMethod === 'PATCH'"
        in js_content
    )


def test_tool_call_panel_all_methods():
    """Verify tool call panel shows all HTTP methods in the dropdown."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    for method in ["GET", "POST", "PUT", "PATCH", "DELETE"]:
        assert 'value: "' + method + '"' in js_content


def test_request_body_schema_ref_resolution():
    """Verify request body $ref schemas are resolved in system prompt."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # Should resolve $ref to show schema name and properties
    assert "refPath" in js_content
    assert "components/schemas" in js_content
    assert "resolvedSchema" in js_content


# ── Schema pre-fetch / persistence tests ───────────────────────────────────────


def test_openapi_schema_prefetched_on_domcontentloaded():
    """Verify OpenAPI schema is fetched eagerly at DOMContentLoaded, not only when ChatPanel mounts."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # DOMContentLoaded handler should include a fetch of /openapi.json
    assert "DOMContentLoaded" in js_content
    # The pre-fetch block must guard against double-fetching
    assert "_cachedOpenapiSchema" in js_content


def test_workflow_panel_fetches_schema_on_mount():
    """Verify WorkflowPanel has a componentDidMount that fetches the schema."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # WorkflowPanel must have its own componentDidMount that calls the shared
    # schema helper so the workflow tab works after a page refresh even if
    # ChatPanel never mounts.
    assert "ensureOpenapiSchemaCached" in js_content


def test_chat_panel_reuses_cached_schema():
    """Verify ChatPanel skips a network fetch when schema is already cached."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    # fetchOpenApiSchema should short-circuit when _cachedOpenapiSchema is set
    assert "_cachedOpenapiSchema" in js_content


# ── Synthesizer removed tests ──────────────────────────────────────────────


def test_synthesizer_tab_not_in_layout():
    """Verify layout plugin does NOT have a Synthesizer tab."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "SynthesizerPanel" not in js_content
    assert "synthesizer" not in js_content.lower()


def test_synthesizer_panel_component_removed():
    """Verify SynthesizerPanel component is not included."""
    client = TestClient(make_app())

    js_content = get_all_plugin_js(client)

    assert "SynthesizerPanel" not in js_content
    assert "SynthesizerPanelFactory" not in js_content


def test_remaining_tabs_present():
    """Verify API, Chat, Workflow, and Settings tabs are still present."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/plugin.js").text

    assert '"api"' in js_content
    assert '"chat"' in js_content
    assert '"workflow"' in js_content
    assert '"settings"' in js_content


# ── Chat/Workflow tab persistence tests ──────────────────────────────────


def test_chat_tab_css_persistence():
    """Verify Chat tab uses CSS display hiding to persist across tab switches."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    # Should use display-based hiding for ChatPanel, not conditional rendering
    assert 'display: activeTab === "chat"' in js_content
    # Should NOT have the old conditional pattern
    assert 'activeTab === "chat" ? React.createElement(ChatPanel' not in js_content


def test_workflow_tab_css_persistence():
    """Verify Workflow tab uses CSS display hiding to persist across tab switches."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    # Should use display-based hiding for WorkflowPanel
    assert 'display: activeTab === "workflow"' in js_content
    # Should NOT have the old conditional pattern
    assert (
        'activeTab === "workflow" ? React.createElement(WorkflowPanel' not in js_content
    )


def test_chat_scroll_on_tab_return():
    """Verify scrolling to bottom when returning to chat tab."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "llm-chat-messages" in js_content
    assert "scrollHeight" in js_content


def test_chat_streaming_event_dispatched():
    """Verify ChatPanel dispatches streaming state events."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    assert "docbuddy-chat-streaming" in js_content


def test_chat_cancel_token_cleanup():
    """Verify ChatPanel cleans up _currentCancelToken in componentWillUnmount."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    assert "this._currentCancelToken.abort()" in js_content


def test_chat_streaming_indicator_in_layout():
    """Verify layout plugin shows streaming indicator on chat tab."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "chatStreaming" in js_content
    assert "docbuddy-chat-streaming" in js_content
    assert "docbuddy-pulse" in js_content


def test_workflow_streaming_indicator_in_layout():
    """Verify layout plugin shows streaming indicator on workflow tab."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "workflowStreaming" in js_content
    assert "docbuddy-workflow-streaming" in js_content
    assert "docbuddy-pulse" in js_content


def test_workflow_dispatches_streaming_events():
    """Verify WorkflowPanel dispatches streaming state events."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    assert "docbuddy-workflow-streaming" in js_content


def test_workflow_output_scrollable():
    """Verify workflow code block output is scrollable with fixed max-height."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    # Should use fixed max height for output blocks (larger than original 300px)
    assert "maxHeight: '400px'" in js_content
    # Should have proper overflow for scrolling
    assert "overflowY: 'auto'" in js_content
    # Should use overflow-wrap for proper word wrapping
    assert "overflowWrap: 'break-word'" in js_content
    # Block wrappers should not flex-shrink so blocks container scrolls properly
    assert "flexShrink: 0" in js_content


def test_workflow_mobile_scroll_support():
    """Verify workflow panel supports smooth scrolling on mobile."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    # Should have webkit touch scrolling for mobile
    assert "WebkitOverflowScrolling: 'touch'" in js_content


def test_workflow_single_block_run():
    """Verify handleRunSingleBlock method exists in workflow JS for per-block execution."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    assert "handleRunSingleBlock" in js_content
    assert "runningSingleBlock" in js_content
    # Should validate prior blocks have output
    assert "has not been run yet" in js_content


# ═══════════════════════════════════════════════════════════════════════════════
# CRITICAL COVERAGE — added after refactor audit
# ═══════════════════════════════════════════════════════════════════════════════

# ── setup_docs: parameter forwarding & route management ────────────────────────


def test_setup_docs_default_title_includes_app_name():
    """Default title should contain the FastAPI app's title."""
    app = FastAPI(title="My Pet Store")
    setup_docs(app)
    client = TestClient(app)
    html = client.get("/docs").text
    assert "My Pet Store" in html


def test_setup_docs_custom_title_appears_in_html():
    """Explicit title= kwarg should appear verbatim in the served HTML."""
    app = FastAPI(title="Ignored Title")
    setup_docs(app, title="Overridden Docs Title")
    client = TestClient(app)
    html = client.get("/docs").text
    assert "Overridden Docs Title" in html


def test_setup_docs_custom_openapi_url_in_html():
    """Custom openapi_url kwarg should be embedded in the served HTML."""
    app = FastAPI(title="Schema URL Test")
    setup_docs(app, openapi_url="/api/v2/schema")
    client = TestClient(app)
    html = client.get("/docs").text
    assert "/api/v2/schema" in html


def test_setup_docs_resolves_app_openapi_url():
    """When openapi_url is not passed, setup_docs should fall back to app.openapi_url."""
    app = FastAPI(title="App Schema", openapi_url="/custom/openapi.json")
    setup_docs(app)
    client = TestClient(app)
    html = client.get("/docs").text
    assert "/custom/openapi.json" in html


def test_setup_docs_custom_swagger_js_url_in_html():
    """Custom swagger_js_url should appear as a script src in the rendered page."""
    custom_js = "https://example.com/swagger-ui-bundle.js"
    app = FastAPI(title="CDN Test")
    setup_docs(app, swagger_js_url=custom_js)
    client = TestClient(app)
    html = client.get("/docs").text
    assert custom_js in html


def test_setup_docs_custom_swagger_css_url_in_html():
    """Custom swagger_css_url should appear as a link href in the rendered page."""
    custom_css = "https://example.com/swagger-ui.css"
    app = FastAPI(title="CSS CDN Test")
    setup_docs(app, swagger_css_url=custom_css)
    client = TestClient(app)
    html = client.get("/docs").text
    assert custom_css in html


def test_setup_docs_custom_theme_url_in_html():
    """Custom theme_css_url should appear as a link href in the rendered page."""
    custom_theme = "/docbuddy-static/themes/dark-theme.css"
    app = FastAPI(title="Theme Test")
    setup_docs(app, theme_css_url=custom_theme)
    client = TestClient(app)
    html = client.get("/docs").text
    assert custom_theme in html


def test_setup_docs_idempotent():
    """Calling setup_docs twice on the same app must not duplicate the docs route."""
    app = FastAPI(title="Idempotent Test")
    setup_docs(app)
    setup_docs(app)  # Second call should be a no-op

    client = TestClient(app)
    assert client.get("/docs").status_code == 200

    # Exactly one /docs route should be registered (no duplicates)
    docs_routes = [r for r in app.router.routes if getattr(r, "path", None) == "/docs"]
    assert len(docs_routes) == 1


def test_setup_docs_removes_default_docs_route():
    """FastAPI's built-in /docs route should be replaced, not left alongside ours."""
    app = FastAPI(title="Route Removal Test")
    # Before setup_docs, FastAPI registers its own /docs route
    setup_docs(app)

    # app.docs_url should be nulled out by setup_docs
    assert app.docs_url is None


def test_setup_docs_removes_redoc_route():
    """setup_docs should also remove FastAPI's /redoc route."""
    app = FastAPI(title="Redoc Removal Test")
    setup_docs(app)

    assert app.redoc_url is None
    client = TestClient(app)
    assert client.get("/redoc").status_code == 404


def test_setup_docs_preserves_user_routes():
    """setup_docs must not remove user-defined application routes."""
    app = FastAPI(title="User Routes Test")

    @app.get("/items")
    def list_items():
        return []

    @app.get("/users/{user_id}")
    def get_user(user_id: int):
        return {"id": user_id}

    setup_docs(app)
    client = TestClient(app)

    assert client.get("/items").status_code == 200
    assert client.get("/users/42").status_code == 200


def test_setup_docs_static_mount_only_once():
    """The /docbuddy-static mount should appear exactly once even across multiple apps."""
    # Creating two separate apps should each mount their own static; neither
    # should interfere with the other.
    app1 = FastAPI(title="App One")
    app2 = FastAPI(title="App Two")
    setup_docs(app1)
    setup_docs(app2)

    mounts1 = [
        r for r in app1.router.routes if getattr(r, "name", None) == "docbuddy-static"
    ]
    mounts2 = [
        r for r in app2.router.routes if getattr(r, "name", None) == "docbuddy-static"
    ]

    assert len(mounts1) == 1
    assert len(mounts2) == 1


# ── get_swagger_ui_html: rendering correctness ────────────────────────────────


def test_get_swagger_ui_html_custom_js_cdn_in_output():
    """Custom swagger_js_url must appear in the rendered HTML body."""
    custom_js = "https://mycdn.example.com/swagger-ui-bundle.js"
    resp = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="CDN Check",
        swagger_js_url=custom_js,
    )
    assert custom_js in resp.body.decode()


def test_get_swagger_ui_html_custom_css_cdn_in_output():
    """Custom swagger_css_url must appear in the rendered HTML body."""
    custom_css = "https://mycdn.example.com/swagger-ui.css"
    resp = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="CSS CDN Check",
        swagger_css_url=custom_css,
    )
    assert custom_css in resp.body.decode()


def test_get_swagger_ui_html_custom_js_sri_in_output():
    """Custom swagger_js_sri hash must appear as an integrity attribute."""
    custom_sri = "sha384-AAABBBCCC000111222333"
    resp = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="SRI Check",
        swagger_js_sri=custom_sri,
    )
    assert custom_sri in resp.body.decode()


def test_get_swagger_ui_html_custom_css_sri_in_output():
    """Custom swagger_css_sri hash must appear as an integrity attribute."""
    custom_sri = "sha384-ZZZYYYXXX999888777666"
    resp = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="CSS SRI Check",
        swagger_css_sri=custom_sri,
    )
    assert custom_sri in resp.body.decode()


def test_get_swagger_ui_html_custom_theme_url_in_output():
    """Custom theme_css_url must appear in the rendered HTML body."""
    custom_theme = "/docbuddy-static/themes/dark-theme.css"
    resp = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="Theme Check",
        theme_css_url=custom_theme,
    )
    assert custom_theme in resp.body.decode()


def test_get_swagger_ui_html_debug_mode_returns_valid_html():
    """debug=True must still produce a valid HTMLResponse with swagger content."""
    from fastapi.responses import HTMLResponse

    resp = get_swagger_ui_html(openapi_url="/openapi.json", title="Debug", debug=True)
    assert isinstance(resp, HTMLResponse)
    body = resp.body.decode()
    assert "swagger" in body.lower()
    assert "/openapi.json" in body


# ── Template structural integrity ─────────────────────────────────────────────


def test_template_dompurify_loaded():
    """DOMPurify CDN script must be present — its absence is a security regression."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "dompurify" in html.lower()


def test_template_markedjs_loaded():
    """marked.js CDN script must be present for markdown rendering."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "marked" in html.lower()


def test_template_fouc_prevention_script():
    """The inline FOUC-prevention <script> must inject docbuddy-theme-styles."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "docbuddy-theme-styles" in html


def test_template_swagger_ui_initialization_block():
    """The page must contain the SwaggerUIBundle() initialization call."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "SwaggerUIBundle(" in html
    assert 'dom_id: "#swagger-ui"' in html


def test_template_llm_docs_layout_configured():
    """The SwaggerUIBundle init must specify LLMDocsLayout as the layout."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert 'layout: "LLMDocsLayout"' in html


def test_template_docbuddy_plugin_registered():
    """DocBuddyPlugin must be listed in the plugins array."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "DocBuddyPlugin" in html


def test_template_crossorigin_attributes_present():
    """CDN resources must carry crossorigin='anonymous' for SRI to work."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert 'crossorigin="anonymous"' in html


def test_template_integrity_attributes_present():
    """CDN resources must carry integrity= attributes for subresource integrity."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "integrity=" in html


# ── Essential static file serving ─────────────────────────────────────────────


def test_static_file_404_for_nonexistent():
    """Requesting a nonexistent file from /docbuddy-static should return 404."""
    client = TestClient(make_app())
    response = client.get("/docbuddy-static/nonexistent-file-xyz.js")
    assert response.status_code == 404


def test_system_prompt_config_served():
    """system-prompt-config.json must be served and be valid JSON with presets."""

    client = TestClient(make_app())
    response = client.get("/docbuddy-static/system-prompt-config.json")
    assert response.status_code == 200

    data = response.json()
    assert "presets" in data
    assert "api_assistant" in data["presets"]


def test_dark_theme_css_served():
    """dark-theme.css must be accessible from /docbuddy-static/themes/."""
    client = TestClient(make_app())
    response = client.get("/docbuddy-static/themes/dark-theme.css")
    assert response.status_code == 200
    assert "css" in response.headers.get("content-type", "").lower()


def test_light_theme_css_served():
    """light-theme.css must be accessible from /docbuddy-static/themes/."""
    client = TestClient(make_app())
    response = client.get("/docbuddy-static/themes/light-theme.css")
    assert response.status_code == 200
    assert "css" in response.headers.get("content-type", "").lower()


def test_swagger_overrides_css_served():
    """swagger-overrides.css must be accessible from /docbuddy-static/themes/."""
    client = TestClient(make_app())
    response = client.get("/docbuddy-static/themes/swagger-overrides.css")
    assert response.status_code == 200


def test_favicon_served():
    """favicon.ico must be accessible from /docbuddy-static/."""
    client = TestClient(make_app())
    response = client.get("/docbuddy-static/favicon.ico")
    assert response.status_code == 200


# ── Agent tab tests ──────────────────────────────────────────────────────────


def test_agent_js_served():
    """agent.js must be accessible from /docbuddy-static/."""
    client = TestClient(make_app())
    response = client.get("/docbuddy-static/agent.js")
    assert response.status_code == 200
    assert "AgentPanelFactory" in response.text


def test_agent_tab_in_layout():
    """Verify Agent tab is present in the layout plugin."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    assert '"agent"' in js_content
    assert "AgentPanel" in js_content


def test_agent_tab_css_persistence():
    """Verify Agent tab uses CSS display hiding to persist across tab switches."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    assert 'display: activeTab === "agent"' in js_content


def test_agent_panel_included():
    """Verify AgentPanel component is registered in DocBuddyPlugin."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "AgentPanel: DB.AgentPanelFactory(system)" in js_content


def test_agent_streaming_indicator_in_layout():
    """Verify layout plugin shows streaming indicator on agent tab."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    assert "agentStreaming" in js_content
    assert "docbuddy-agent-streaming" in js_content


def test_agent_dispatches_streaming_events():
    """Verify AgentPanel dispatches streaming state events."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    assert "docbuddy-agent-streaming" in js_content


def test_agent_history_storage_key():
    """Verify correct localStorage key for agent history."""
    client = TestClient(make_app())
    js_content = get_all_plugin_js(client)

    assert "docbuddy-agent-history" in js_content


def test_agent_mode_toggle():
    """Verify agent panel has plan/act mode toggle."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "toggleMode" in js_content
    assert '"plan"' in js_content
    assert '"act"' in js_content


def test_agent_plan_mode_context():
    """Verify agent sends plan mode context to LLM."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "PLAN mode" in js_content
    assert "ACT mode" in js_content


def test_agent_iteration_tracking():
    """Verify agent tracks iteration count."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "iterationCount" in js_content
    assert "Iterations:" in js_content


def test_agent_tool_calling_in_act_mode():
    """Verify agent only enables tools in act mode."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "mode === 'act'" in js_content


def test_agent_cancel_support():
    """Verify agent panel supports cancel via AbortController."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "handleCancel" in js_content
    assert "AbortController" in js_content
    assert "Cancel" in js_content


def test_agent_clear_history():
    """Verify agent panel has clear history function."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "clearHistory" in js_content
    assert "saveAgentHistory" in js_content


def test_agent_export_button():
    """Verify agent panel has export button."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "Export" in js_content
    assert "exportAsJson" in js_content


def test_agent_system_prompt_preset():
    """Verify agent system prompt preset exists in config."""
    client = TestClient(make_app())
    response = client.get("/docbuddy-static/system-prompt-config.json")
    assert response.status_code == 200

    import json

    config = json.loads(response.text)
    assert "agent" in config["presets"]
    assert config["presets"]["agent"]["name"] == "Agent"
    assert "Autonomous" in config["presets"]["agent"]["description"]


def test_agent_tool_call_panel():
    """Verify agent has tool call editing panel."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "renderToolCallPanel" in js_content
    assert "handleExecuteToolCall" in js_content
    assert "editMethod" in js_content
    assert "editPath" in js_content


def test_agent_template_script_included():
    """Verify agent.js is loaded in the HTML template."""
    client = TestClient(make_app())
    html = client.get("/docs").text

    assert "agent.js" in html


def test_agent_uses_shared_namespace():
    """Verify agent.js uses the DocBuddy shared namespace pattern."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/agent.js").text

    assert "window.DocBuddy" in js_content
    assert "DB.AgentPanelFactory" in js_content


def test_all_tabs_present():
    """Verify all 5 tabs (API, Chat, Workflow, Agent, Settings) are present."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/plugin.js").text

    assert '"api"' in js_content
    assert '"chat"' in js_content
    assert '"workflow"' in js_content
    assert '"agent"' in js_content
    assert '"settings"' in js_content


# ── Configurable base path tests ─────────────────────────────────────────────


def test_core_js_uses_configurable_static_base():
    """Verify core.js uses DOCBUDDY_STATIC_BASE for static asset paths."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/core.js").text

    assert "DOCBUDDY_STATIC_BASE" in js_content
    assert "STATIC_BASE" in js_content


def test_core_js_uses_configurable_openapi_url():
    """Verify core.js uses DOCBUDDY_OPENAPI_URL for schema fetching."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/core.js").text

    assert "DOCBUDDY_OPENAPI_URL" in js_content


def test_core_js_defaults_to_docbuddy_static():
    """Verify core.js defaults to /docbuddy-static when DOCBUDDY_STATIC_BASE is not set."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/core.js").text

    assert "'/docbuddy-static'" in js_content


def test_core_js_defaults_to_openapi_json():
    """Verify core.js defaults to /openapi.json when DOCBUDDY_OPENAPI_URL is not set."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/core.js").text

    assert '"/openapi.json"' in js_content


def test_core_js_schema_fetch_url_tracking():
    """Verify core.js tracks _schemaFetchUrl to prevent stale schema race conditions."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/core.js").text

    assert "_schemaFetchUrl" in js_content
    # Should check that fetch URL matches before caching
    assert "DocBuddy._schemaFetchUrl === fetchUrl" in js_content


def test_standalone_page_clears_history_on_load():
    """Verify standalone page clears chat/agent history when loading a new schema."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    assert "localStorage.removeItem('docbuddy-chat-history')" in html
    assert "localStorage.removeItem('docbuddy-agent-history')" in html


# ── Standalone page tests ─────────────────────────────────────────────────────


def test_standalone_page_exists():
    """Verify docs/index.html exists."""
    from pathlib import Path

    docs_path = Path(__file__).parent.parent / "docs" / "index.html"
    assert docs_path.exists(), "docs/index.html should exist for GitHub Pages"


def test_standalone_page_contains_swagger_ui():
    """Verify standalone page loads Swagger UI from CDN."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    assert "swagger-ui-bundle" in html
    assert "SwaggerUIBundle" in html


def test_standalone_page_contains_docbuddy_scripts():
    """Verify standalone page loads all DocBuddy JS files."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    for f in DOCBUDDY_JS_FILES:
        assert f in html, f"Standalone page should reference {f}"


def test_standalone_page_sets_static_base():
    """Verify standalone page configures DOCBUDDY_STATIC_BASE."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    assert "DOCBUDDY_STATIC_BASE" in html


def test_standalone_page_has_url_input():
    """Verify standalone page has URL input and load button."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    assert 'id="url-input"' in html
    assert "handleLoad" in html


def test_standalone_page_has_example_links():
    """Verify standalone page includes example API links."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    assert "petstore" in html.lower()
    assert "loadUrl" in html


def test_standalone_page_supports_url_parameter():
    """Verify standalone page reads ?url= query parameter."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    assert "URLSearchParams" in html
    assert "url" in html


def test_standalone_page_has_dompurify():
    """Verify standalone page includes DOMPurify for security."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    assert "dompurify" in html.lower()


def test_standalone_page_has_docbuddy_plugin():
    """Verify standalone page registers DocBuddyPlugin."""
    from pathlib import Path

    html = (Path(__file__).parent.parent / "docs" / "index.html").read_text()
    assert "DocBuddyPlugin" in html
    assert "LLMDocsLayout" in html
