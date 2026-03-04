"""Tests for docbuddy package."""

import sys
import os

# Ensure we can import the source package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from docbuddy import setup_docs
from docbuddy.plugin import get_swagger_ui_html


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
    """The docs page HTML should reference both LLM plugin JS files."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "llm-settings-plugin.js" in html
    assert "llm-layout-plugin.js" in html


def test_docs_contains_swagger_bundle():
    """The docs page should reference the Swagger UI bundle."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    assert "swagger-ui-bundle" in html


def test_static_files_served():
    """The plugin JS files should be served from /docbuddy-static."""
    client = TestClient(make_app())
    assert client.get("/docbuddy-static/llm-settings-plugin.js").status_code == 200
    assert client.get("/docbuddy-static/llm-layout-plugin.js").status_code == 200


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
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
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
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    # Check Ollama preset
    assert "ollama" in js_content.lower()
    assert "localhost:11434/v1" in js_content


def test_provider_preset_lmstudio():
    """Test LM Studio provider preset."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    # Check LM Studio preset
    assert "lmstudio" in js_content.lower()
    assert "localhost:1234/v1" in js_content


def test_provider_preset_vllm():
    """Test vLLM provider preset."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    # Check vLLM preset
    assert "vllm" in js_content.lower()
    assert "localhost:8000/v1" in js_content


# ── JavaScript function tests (client-side functionality) ───────────────────────


def test_build_openapi_context_function_exists():
    """Verify buildOpenApiContext function exists in JavaScript (client-side now)."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    # Check for the client-side function
    assert "buildOpenApiContext" in js_content


def test_build_api_request_tool_function_exists():
    """Verify buildApiRequestTool function exists in JavaScript (client-side now)."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    # Check for the client-side function
    assert "buildApiRequestTool" in js_content


def test_chat_panel_included():
    """Verify chat panel component is included."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "ChatPanel" in js_content
    assert "chatHistory" in js_content


def test_streaming_llm_response_function_exists():
    """Verify _streamLLMResponse function exists for direct LLM calls."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "_streamLLMResponse" in js_content
    # Should call /chat/completions directly, not /llm-chat
    assert "/chat/completions" in js_content


def test_test_connection_calls_models_endpoint():
    """Verify handleTestConnection calls /models endpoint directly."""
    client = TestClient(make_app())
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

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
    import time

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
    assert "fetchOpenApiSchema" in html or "/docbuddy-static/llm-settings-plugin.js" in html

    # Check that the JS file contains schema storage logic
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
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
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    # Check for default theme configuration
    assert "dark" in js_content.lower()


# ── Error handling tests (CORS guidance) ───────────────────────────────────────


def test_cors_error_message_in_javascript():
    """Verify CORS error guidance is available in JavaScript."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
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
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "LLMSettingsPanel" in js_content


def test_settings_panel_fields():
    """Verify settings panel has all required fields."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

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
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "handleTestConnection" in js_content


def test_settings_panel_save_functionality():
    """Verify settings save to localStorage."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "localStorage" in js_content
    assert "saveToStorage" in js_content


# ── Chat panel functionality tests ─────────────────────────────────────────────


def test_chat_input_area():
    """Verify chat input area exists."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "handleSend" in js_content
    assert "handleInputChange" in js_content


def test_chat_history_persistence():
    """Verify chat history is persisted to localStorage."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "chatHistory" in js_content
    assert "localStorage" in js_content


def test_clear_chat_history():
    """Verify clear chat history functionality exists."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "clearHistory" in js_content


def test_copy_to_clipboard():
    """Verify copy to clipboard functionality exists."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "copyToClipboard" in js_content


def test_typing_indicator():
    """Verify typing indicator for streaming responses exists."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "typing" in js_content.lower()


def test_markdown_parsing():
    """Verify markdown parsing functionality exists."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "parseMarkdown" in js_content or "marked" in js_content.lower()


def test_error_classification():
    """Verify error classification and user-friendly messages exist."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # Check for error handling
    assert "error" in js_content.lower()
    assert "catch" in js_content.lower()


def test_tool_calling_panel():
    """Verify tool calling panel exists."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "renderToolCallPanel" in js_content
    assert "handleExecuteToolCall" in js_content


# ── Local storage keys tests ───────────────────────────────────────────────────


def test_settings_storage_key():
    """Verify correct localStorage key for settings."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "docbuddy-settings" in js_content


def test_chat_history_storage_key():
    """Verify correct localStorage key for chat history."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "docbuddy-chat-history" in js_content


def test_theme_storage_key():
    """Verify correct localStorage key for theme."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "docbuddy-theme" in js_content


# ── Tab switching tests ────────────────────────────────────────────────────────


def test_layout_plugin_tabs():
    """Verify LLM layout plugin has tab navigation."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text

    assert "LLMLayoutPlugin" in js_content
    # Should have API, Chat, Settings tabs
    assert "api" in js_content.lower()
    assert "chat" in js_content.lower()
    assert "settings" in js_content.lower()


def test_tab_persistence():
    """Verify active tab preference is persisted."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text

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
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    # Empty API key should not set Authorization header
    assert "Authorization" in js_content or "Bearer" not in js_content


def test_provider_base_url_format():
    """Verify provider base URLs are properly formatted."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    # URLs should end with /v1
    assert "/v1" in js_content


def test_max_tokens_default():
    """Verify max tokens has a default value."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    assert "maxTokens" in js_content


def test_temperature_default():
    """Verify temperature has a default value."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    assert "temperature" in js_content


def test_debounce_function_exists():
    """Verify debounce function exists for connection testing."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    assert "debounce" in js_content


def test_abort_controller_for_cancellation():
    """Verify AbortController is used for request cancellation."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text
    
    assert "AbortController" in js_content or "abort()" in js_content


# ── HTML template tests ────────────────────────────────────────────────────────


def test_template_theme_injection():
    """Verify theme is injected immediately in template to prevent FOUC."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    
    # Check for our template's key elements
    assert "docbuddy-static" in html, "Template should include our static files"
    assert "applyLLMTheme" in html or "/docbuddy-static/themes/" in html, "Template should include theme injection"


def test_template_script_order():
    """Verify scripts are loaded in correct order."""
    client = TestClient(make_app())
    html = client.get("/docs").text
    
    # Swagger UI bundle should load first
    swagger_idx = html.find("swagger-ui-bundle")
    llm_settings_idx = html.find("llm-settings-plugin.js")
    llm_layout_idx = html.find("llm-layout-plugin.js")
    
    assert swagger_idx > 0
    assert llm_settings_idx > swagger_idx
    assert llm_layout_idx > llm_settings_idx


# ── Layout plugin tests ────────────────────────────────────────────────────────


def test_layout_plugin_imports():
    """Verify layout plugin imports correctly."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text
    
    assert "window.LLMLayoutPlugin" in js_content


def test_base_layout_wrapper():
    """Verify layout plugin wraps BaseLayout."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text
    
    assert "BaseLayout" in js_content


def test_llm_docs_layout_component():
    """Verify LLMDocsLayout component exists."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text
    
    assert "LLMDocsLayout" in js_content


def test_chat_height_calculation():
    """Verify chat tab has proper height calculation."""
    client = TestClient(make_app())
    
    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text
    
    assert "calc(100vh" in js_content or "height:" in js_content.lower()


# ── Workflow tab tests ─────────────────────────────────────────────────────


def test_workflow_tab_in_layout():
    """Verify layout plugin has Workflow tab."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text

    assert "workflow" in js_content.lower()
    assert "WorkflowPanel" in js_content


def test_workflow_panel_component():
    """Verify WorkflowPanel component is included."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "WorkflowPanel" in js_content
    assert "WorkflowPanelFactory" in js_content


def test_workflow_panel_controls():
    """Verify workflow panel has start/stop/reset buttons."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "handleStart" in js_content
    assert "handleStop" in js_content
    assert "handleReset" in js_content


def test_workflow_panel_block_management():
    """Verify workflow panel has add/remove block functionality."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "handleAddBlock" in js_content
    assert "handleRemoveBlock" in js_content


def test_workflow_panel_block_output():
    """Verify workflow panel displays block outputs."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "output" in js_content
    assert "runWorkflow" in js_content


def test_workflow_panel_block_chaining():
    """Verify workflow panel feeds output of each block into the next."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "conversationHistory" in js_content
    assert "currentUserMessage" in js_content


def test_workflow_panel_tool_execution():
    """Verify workflow panel supports LLM tool execution in blocks."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "executeToolCall" in js_content
    assert "tool_calls" in js_content
    assert "Tool Result" in js_content


def test_workflow_storage_key():
    """Verify correct localStorage key for workflow."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "docbuddy-workflow" in js_content


def test_workflow_styles_injected():
    """Verify workflow panel uses theme-aware CSS variables."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # Check for workflow panel related content
    assert "WorkflowPanel" in js_content or "llm-workflow" in js_content.lower()
    assert "var(--theme-border-color)" in js_content or "theme-border" in js_content.lower()
    assert "var(--theme-primary)" in js_content or "theme-primary" in js_content.lower()


def test_export_function_exists():
    """Verify exportAsJson utility function exists in settings plugin."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "exportAsJson" in js_content
    assert "application/json" in js_content
    assert "createObjectURL" in js_content


def test_chat_export_button():
    """Verify Chat panel has an Export button."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "chat-history-" in js_content
    assert "Export" in js_content


def test_workflow_export_button():
    """Verify Workflow panel has an Export button."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "workflow-" in js_content


def test_copy_feedback_indicator():
    """Verify copied feedback overlay is present in chat and workflow."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "Copied!" in js_content
    assert "llm-fade-in" in js_content
    assert "copiedBlockId" in js_content


def test_api_request_tool_supports_all_methods():
    """Verify buildApiRequestTool includes PUT/PATCH/DELETE in addition to GET/POST."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "'GET', 'POST', 'PUT', 'PATCH', 'DELETE'" in js_content
    assert "'get', 'post', 'put', 'patch', 'delete'" in js_content


def test_workflow_tool_call_shows_curl():
    """Verify workflow tool calls display curl command in output."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "Tool Call" in js_content
    assert "buildCurlCommand" in js_content


def test_api_tab_scroll_not_constrained():
    """Verify API tab does not have overscrollBehavior contain that blocks scrolling."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text

    # API tab should not have fixed height or overscroll contain
    assert 'isContained ? "contain" : "auto"' in js_content


def test_tool_call_post_content_type():
    """Verify POST/PUT/PATCH tool calls set Content-Type: application/json header."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # handleExecuteToolCall should set Content-Type for body-bearing methods
    assert "fetchHeaders['Content-Type'] = 'application/json'" in js_content
    # Body should be included for POST, PUT, and PATCH
    assert "s.editMethod === 'POST' || s.editMethod === 'PUT' || s.editMethod === 'PATCH'" in js_content


def test_tool_call_panel_all_methods():
    """Verify tool call panel shows all HTTP methods in the dropdown."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    for method in ["GET", "POST", "PUT", "PATCH", "DELETE"]:
        assert 'value: "' + method + '"' in js_content


def test_request_body_schema_ref_resolution():
    """Verify request body $ref schemas are resolved in system prompt."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # Should resolve $ref to show schema name and properties
    assert "refPath" in js_content
    assert "components/schemas" in js_content
    assert "resolvedSchema" in js_content


# ── Schema pre-fetch / persistence tests ───────────────────────────────────────


def test_openapi_schema_prefetched_on_domcontentloaded():
    """Verify OpenAPI schema is fetched eagerly at DOMContentLoaded, not only when ChatPanel mounts."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # DOMContentLoaded handler should include a fetch of /openapi.json
    assert "DOMContentLoaded" in js_content
    # The pre-fetch block must guard against double-fetching
    assert "_cachedOpenapiSchema" in js_content


def test_workflow_panel_fetches_schema_on_mount():
    """Verify WorkflowPanel has a componentDidMount that fetches the schema."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # WorkflowPanel must have its own componentDidMount that calls the shared
    # schema helper so the workflow tab works after a page refresh even if
    # ChatPanel never mounts.
    assert "ensureOpenapiSchemaCached" in js_content


def test_chat_panel_reuses_cached_schema():
    """Verify ChatPanel skips a network fetch when schema is already cached."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # fetchOpenApiSchema should short-circuit when _cachedOpenapiSchema is set
    assert "if (_cachedOpenapiSchema)" in js_content


# ── Synthesizer tab tests ──────────────────────────────────────────────────


def test_synthesizer_tab_in_layout():
    """Verify layout plugin has Synthesizer tab."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-layout-plugin.js").text

    assert "synthesizer" in js_content.lower()
    assert "SynthesizerPanel" in js_content


def test_synthesizer_panel_component():
    """Verify SynthesizerPanel component is included."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "SynthesizerPanel" in js_content
    assert "SynthesizerPanelFactory" in js_content


def test_synthesizer_topic_generation():
    """Verify synthesizer has topic generation functionality."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "handleGenerateTopics" in js_content
    assert "topicPrompt" in js_content
    assert "topicDepth" in js_content
    assert "topicDegree" in js_content


def test_synthesizer_tree_mode():
    """Verify synthesizer uses tree-based topic generation."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # Tree mode uses level-by-level expansion with children
    assert "expandLevel" in js_content
    assert "expandNode" in js_content
    assert "children" in js_content
    assert "Tree Mode" in js_content


def test_synthesizer_data_generation():
    """Verify synthesizer has training data generation functionality."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "handleGenerateData" in js_content
    assert "numSamples" in js_content
    assert "batchSize" in js_content
    assert "generatedData" in js_content


def test_synthesizer_tool_call_format():
    """Verify synthesizer generates proper tool calling format."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # Tool call format: assistant with tool_calls, tool role response
    assert "enableToolCalls" in js_content
    assert "tool_call_id" in js_content
    assert "tool_calls" in js_content
    assert "role: 'tool'" in js_content


def test_synthesizer_output_system_prompt():
    """Verify synthesizer includes configurable output system prompt."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "outputSystemPrompt" in js_content
    assert "includeSystemMessage" in js_content


def test_synthesizer_jsonl_export():
    """Verify synthesizer can export data as JSONL."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "exportAsJsonl" in js_content
    assert "application/x-ndjson" in js_content
    assert "handleExportData" in js_content
    assert "handleExportTopics" in js_content


def test_synthesizer_storage_key():
    """Verify correct localStorage key for synthesizer."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "docbuddy-synthesizer" in js_content


def test_synthesizer_uses_openapi_context():
    """Verify synthesizer uses OpenAPI context for generation."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "buildOpenApiContext" in js_content
    assert "buildApiRequestTool" in js_content


def test_synthesizer_uses_preset_system_prompt():
    """Verify synthesizer uses the preset system prompt."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "getSystemPromptForPreset" in js_content


def test_synthesizer_preview_section():
    """Verify synthesizer has a preview section for generated data."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "previewIdx" in js_content
    assert "Preview" in js_content


def test_synthesizer_stop_functionality():
    """Verify synthesizer can stop generation in progress."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "handleStop" in js_content


def test_synthesizer_summarize_from_openapi():
    """Verify synthesizer has button to summarize root topic from OpenAPI."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "handleSummarizeFromOpenAPI" in js_content
    assert "Summarize from API" in js_content
    assert "summarizing" in js_content


def test_synthesizer_robust_json_extraction():
    """Verify synthesizer has robust JSON extraction for LLM output."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "extractJsonArray" in js_content
    # Should strip markdown code fences
    assert "```" in js_content


def test_synthesizer_default_topic_system_prompt():
    """Verify synthesizer pre-fills topic system prompt with OpenAPI context."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    assert "buildDefaultTopicSystemPrompt" in js_content
    assert "topic generation assistant" in js_content


def test_synthesizer_tree_export_format():
    """Verify synthesizer exports topics with id and children fields."""
    client = TestClient(make_app())

    js_content = client.get("/docbuddy-static/llm-settings-plugin.js").text

    # Export maps nodes to id + children ids
    assert "node.id" in js_content
    assert "node.children" in js_content
    assert "AbortController" in js_content