#!/usr/bin/env python3
"""
Minimal request tester for Antigravity-style providers.

Modes:
  - proxy-openai: test local OpenAI-compatible proxies such as anti-api
  - upstream-antigravity: test the Google Antigravity upstream directly

Examples:
  python scripts/test_antigravity_requests.py --mode proxy-openai
  python scripts/test_antigravity_requests.py --mode proxy-openai --base-url http://localhost:8964 --api-key any-value
  python scripts/test_antigravity_requests.py --mode upstream-antigravity --access-token ya29... --project-id cenasburrasdosnock
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


DEFAULT_PROMPT = "Say only: ok"
DEFAULT_PROXY_BASE_URL = "http://localhost:8964"
DEFAULT_PROXY_API_KEY = "any-value"
DEFAULT_UPSTREAM_BASE_URL = "https://cloudcode-pa.googleapis.com"
DEFAULT_UPSTREAM_USER_AGENT = "antigravity/1.15.8 windows/amd64"


PROXY_OPENAI_MODELS = [
    # Antigravity-style official/simple IDs seen in anti-api docs.
    "claude-sonnet-4-5",
    "claude-sonnet-4-5-thinking",
    "claude-opus-4-5-thinking",
    "claude-opus-4-6-thinking",
    "gemini-3-flash",
    "gemini-3-pro-low",
    "gemini-3-pro-high",
    "gpt-oss-120b",
    # NoeFabris README Gemini CLI quota IDs.
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
]


UPSTREAM_ANTIGRAVITY_MODELS = [
    # Documented/simple upstream IDs from the NoeFabris API spec.
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking",
    "gemini-3-flash",
    "gemini-3-pro-low",
    "gemini-3-pro-high",
    # Candidate rollout-dependent ID from README-level naming.
    "gemini-3.1-pro",
]


@dataclass
class TestResult:
    model: str
    status: int
    ok: bool
    elapsed_ms: int
    body_preview: str


def truncate_text(value: str, limit: int = 800) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "...<truncated>"


def pretty_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, indent=2)


def read_response_body(response: Any, limit: int = 4096) -> str:
    body = response.read(limit)
    if isinstance(body, bytes):
        return body.decode("utf-8", errors="replace")
    return str(body)


def send_json_request(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url=url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return int(getattr(response, "status", 200)), read_response_body(response)
    except urllib.error.HTTPError as error:
        body = read_response_body(error)
        return int(error.code), body


def run_proxy_openai_test(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    timeout: int,
) -> TestResult:
    url = base_url.rstrip("/") + "/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 32,
        "temperature": 0,
    }
    started = time.time()
    status, body = send_json_request(url, headers, payload, timeout)
    elapsed_ms = int((time.time() - started) * 1000)
    return TestResult(
        model=model,
        status=status,
        ok=200 <= status < 300,
        elapsed_ms=elapsed_ms,
        body_preview=truncate_text(body),
    )


def run_upstream_antigravity_test(
    base_url: str,
    access_token: str,
    project_id: str,
    model: str,
    prompt: str,
    timeout: int,
) -> TestResult:
    url = base_url.rstrip("/") + "/v1internal:streamGenerateContent?alt=sse"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "User-Agent": DEFAULT_UPSTREAM_USER_AGENT,
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    }
    payload = {
        "project": project_id,
        "model": model,
        "userAgent": "antigravity",
        "requestId": f"agent-test-{int(time.time() * 1000)}",
        "request": {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ]
        },
    }
    started = time.time()
    status, body = send_json_request(url, headers, payload, timeout)
    elapsed_ms = int((time.time() - started) * 1000)
    return TestResult(
        model=model,
        status=status,
        ok=200 <= status < 300,
        elapsed_ms=elapsed_ms,
        body_preview=truncate_text(body),
    )


def print_result(result: TestResult) -> None:
    state = "OK" if result.ok else "ERR"
    print(f"[{state}] {result.model}")
    print(f"  status: {result.status}")
    print(f"  elapsed: {result.elapsed_ms} ms")
    if result.body_preview:
        print("  body:")
        for line in result.body_preview.splitlines():
            print(f"    {line}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test Antigravity-style requests.")
    parser.add_argument(
        "--mode",
        choices=("proxy-openai", "upstream-antigravity"),
        default="proxy-openai",
        help="Which request shape to test.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("ANTI_TEST_BASE_URL", DEFAULT_PROXY_BASE_URL),
        help="Base URL for the selected mode.",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("ANTI_TEST_API_KEY", DEFAULT_PROXY_API_KEY),
        help="API key for proxy-openai mode. Defaults to anti-api style any-value.",
    )
    parser.add_argument(
        "--access-token",
        default=os.environ.get("ANTIGRAVITY_ACCESS_TOKEN", ""),
        help="Bearer access token for upstream-antigravity mode.",
    )
    parser.add_argument(
        "--project-id",
        default=os.environ.get("ANTIGRAVITY_PROJECT_ID", ""),
        help="Google project ID for upstream-antigravity mode.",
    )
    parser.add_argument(
        "--prompt",
        default=DEFAULT_PROMPT,
        help="Prompt text to send.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="Request timeout in seconds.",
    )
    parser.add_argument(
        "--only",
        nargs="*",
        default=[],
        help="Optional exact model names to test.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.mode == "proxy-openai":
        models = PROXY_OPENAI_MODELS
        runner = lambda model: run_proxy_openai_test(
            base_url=args.base_url,
            api_key=args.api_key,
            model=model,
            prompt=args.prompt,
            timeout=args.timeout,
        )
    else:
        if not args.access_token or not args.project_id:
            print("upstream-antigravity mode requires --access-token and --project-id", file=sys.stderr)
            return 2
        if args.base_url == DEFAULT_PROXY_BASE_URL:
            args.base_url = DEFAULT_UPSTREAM_BASE_URL
        models = UPSTREAM_ANTIGRAVITY_MODELS
        runner = lambda model: run_upstream_antigravity_test(
            base_url=args.base_url,
            access_token=args.access_token,
            project_id=args.project_id,
            model=model,
            prompt=args.prompt,
            timeout=args.timeout,
        )

    selected_models = args.only or models
    print("mode:", args.mode)
    print("base_url:", args.base_url)
    print("prompt:", args.prompt)
    print("models:")
    print(pretty_json(selected_models))
    print()

    results: list[TestResult] = []
    for model in selected_models:
        result = runner(model)
        results.append(result)
        print_result(result)
        print()

    ok_count = sum(1 for result in results if result.ok)
    print(f"summary: {ok_count}/{len(results)} passed")
    return 0 if ok_count == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
