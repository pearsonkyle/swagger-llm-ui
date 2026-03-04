"""Core plugin logic: functions to mount the custom LLM-enhanced Swagger UI docs."""

import threading
import weakref
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader


# Locate package static/template directories
_PACKAGE_DIR = Path(__file__).parent
_STATIC_DIR = _PACKAGE_DIR / "static"
_TEMPLATES_DIR = _PACKAGE_DIR / "templates"

# Thread-safe lock for route modification operations
_route_lock = threading.Lock()

# Track which apps have LLM docs setup to avoid duplicate routes
_llm_apps: weakref.WeakSet = weakref.WeakSet()


def get_swagger_ui_html(
    *,
    openapi_url: str,
    title: str,
    swagger_js_url: str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js",
    swagger_css_url: str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css",
    theme_css_url: str = "/docbuddy-static/themes/light-theme.css",
    llm_layout_js_url: str = "/docbuddy-static/llm-layout-plugin.js",
    debug: bool = False,
) -> HTMLResponse:
    """Return an HTMLResponse with the custom Swagger UI + LLM settings panel.

    This is the lower-level helper for users who want to serve the page manually.
    Most users should use :func:`setup_docs` instead.

    Args:
        openapi_url: URL of the OpenAPI JSON schema.
        title: Page title.
        swagger_js_url: CDN URL for Swagger UI JS.
        swagger_css_url: CDN URL for the Swagger UI CSS.
        theme_css_url: URL for the theme CSS file.
        llm_layout_js_url: URL for the LLM layout plugin JS.
        debug: If True, disables template caching for development.
    """
    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=True)

    # Disable cache if in debug mode
    if debug:
        env.auto_reload = True
        env.cache.clear()

    template = env.get_template("swagger_ui.html")
    html = template.render(
        title=title,
        openapi_url=openapi_url,
        swagger_js_url=swagger_js_url,
        swagger_css_url=swagger_css_url,
        theme_css_url=theme_css_url,
        llm_layout_js_url=llm_layout_js_url,
    )
    return HTMLResponse(html)


def setup_docs(
    app: FastAPI,
    *,
    docs_url: str = "/docs",
    title: Optional[str] = None,
    openapi_url: Optional[str] = None,
    swagger_js_url: str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js",
    swagger_css_url: str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css",
    theme_css_url: str = "/docbuddy-static/themes/light-theme.css",
    debug: bool = False,
) -> None:
    """Mount the LLM-enhanced Swagger UI docs on a FastAPI application.

    This function:
    1. Disables FastAPI's default ``/docs`` route.
    2. Mounts the package's static JS files at ``/docbuddy-static``.
    3. Registers a new ``docs_url`` route that serves the custom Swagger UI page
       with the LLM settings panel injected.

    Args:
        app: The FastAPI application instance.
        docs_url: URL path for the docs page (default ``"/docs"``).
        title: Browser tab title (defaults to ``app.title + " – LLM Docs"``).
        openapi_url: URL of the OpenAPI JSON schema (defaults to ``app.openapi_url``).
        swagger_js_url: CDN URL for the Swagger UI JS bundle.
        swagger_css_url: CDN URL for the Swagger UI CSS.
        debug: If True, enables debug mode with template auto-reload (default False).
    """
    resolved_title = title or f"{app.title} – LLM Docs"
    resolved_openapi_url = openapi_url or app.openapi_url or "/openapi.json"

    # Use thread lock for route modification to avoid race conditions
    with _route_lock:
        # Check if this app already has LLM docs setup to avoid duplicates
        if app in _llm_apps:
            return

        # Safely remove any existing docs/redoc routes registered by FastAPI
        from starlette.routing import Route

        # Filter routes while avoiding concurrent modification issues
        original_routes = list(app.router.routes)
        
        # Build set of paths to remove - handle potential None values
        paths_to_remove = {docs_url}
        if app.docs_url:
            paths_to_remove.add(app.docs_url)
        if app.redoc_url:
            paths_to_remove.add(app.redoc_url)
            
        # Filter routes more safely to avoid issues with different route types
        new_routes = []
        for r in original_routes:
            if isinstance(r, Route):
                # Only remove routes with exact path matches
                if r.path in paths_to_remove:
                    continue
            new_routes.append(r)
        
        app.router.routes = new_routes
        app.docs_url = None
        app.redoc_url = None

        # Mount static files for the plugin JS inside the lock to prevent TOCTOU race
        already_mounted = any(
            getattr(r, "name", None) == "docbuddy-static" for r in app.router.routes
        )
        if not already_mounted:
            app.mount(
                "/docbuddy-static",
                StaticFiles(directory=str(_STATIC_DIR)),
                name="docbuddy-static",
            )

        # Mark this app as having LLM docs setup
        _llm_apps.add(app)

    # Register the custom docs route
    @app.get(docs_url, include_in_schema=False)
    async def custom_docs() -> HTMLResponse:
        return get_swagger_ui_html(
            openapi_url=resolved_openapi_url,
            title=resolved_title,
            swagger_js_url=swagger_js_url,
            swagger_css_url=swagger_css_url,
            theme_css_url=theme_css_url,
            llm_layout_js_url="/docbuddy-static/llm-layout-plugin.js",
            debug=debug,
        )
