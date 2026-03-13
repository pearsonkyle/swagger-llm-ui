#!/usr/bin/env python3
"""CLI entry point for launching DocBuddy standalone webpage."""

import argparse
import functools
import http.server
import pathlib
import sys
import threading
import time
import webbrowser


def _pkg_dir() -> pathlib.Path:
    """Return the directory that contains standalone.html and static/."""
    return pathlib.Path(__file__).parent


def main():
    """Launch DocBuddy standalone webpage on port 8008."""
    parser = argparse.ArgumentParser(
        prog="docbuddy",
        description="Launch the DocBuddy standalone AI-enhanced API documentation page.",
        epilog="Example: docbuddy --host 127.0.0.1 --port 9000",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="localhost",
        help="Host to bind the server to (default: localhost)",
    )
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=8008,
        help="Port to run the server on (default: 8008)",
    )

    args = parser.parse_args()

    # Locate the package directory using __file__ – this is the most reliable
    # way to find the installed package assets regardless of Python version,
    # install method (editable, wheel, sdist), or platform.
    pkg_dir = _pkg_dir()
    standalone_path = pkg_dir / "standalone.html"

    if not standalone_path.is_file():
        print(
            f"Error: Could not find 'standalone.html' in the docbuddy package ({pkg_dir})",
            file=sys.stderr,
        )
        sys.exit(1)

    # Serve only the package directory – not the whole repo/site-packages root.
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=str(pkg_dir)
    )

    url = f"http://{args.host}:{args.port}/standalone.html"

    print(f"Serving DocBuddy at {url}")
    print("Press Ctrl+C to stop the server")

    with http.server.HTTPServer((args.host, args.port), handler) as httpd:

        def open_browser():
            time.sleep(0.5)
            webbrowser.open(url)

        thread = threading.Thread(target=open_browser, daemon=True)
        thread.start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            sys.exit(0)
