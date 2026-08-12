"""Dependency-free HTTP entry point for the PR recommender demo UI."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlsplit

from .service import ApplicationService, build_service


MAX_REQUEST_BYTES = 2 * 1024 * 1024
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATIC_DIR = PROJECT_ROOT / "web"


class ApiRequestError(Exception):
    """An error that can safely be returned to the browser."""

    def __init__(
        self,
        message: str,
        *,
        status: HTTPStatus = HTTPStatus.BAD_REQUEST,
        code: str = "bad_request",
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class RecommenderRequestHandler(BaseHTTPRequestHandler):
    """Serve the static application and its small JSON API."""

    server_version = "PRRecommender/0.1"
    service: ApplicationService
    static_dir: Path = DEFAULT_STATIC_DIR

    _post_routes: dict[str, str] = {
        "/api/recommendations": "recommendations",
        "/api/search": "search",
        "/api/ideas": "ideas",
        "/api/plan": "plan",
    }

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        path = urlsplit(self.path).path
        if path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "pr-recommender",
                    "version": 1,
                },
            )
            return
        if path == "/api/bootstrap":
            self._run_service_call(self.service.bootstrap)
            return
        if path.startswith("/api/"):
            self._send_api_error(
                HTTPStatus.NOT_FOUND,
                "not_found",
                "指定されたAPIは存在しません。",
            )
            return
        self._serve_static(path)

    def do_HEAD(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            self._send_api_error(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "このAPIではHEADを利用できません。",
            )
            return
        self._serve_static(path)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        path = urlsplit(self.path).path
        method_name = self._post_routes.get(path)
        if method_name is None:
            if path.startswith("/api/"):
                self._send_api_error(
                    HTTPStatus.NOT_FOUND,
                    "not_found",
                    "指定されたAPIは存在しません。",
                )
            else:
                self._send_api_error(
                    HTTPStatus.METHOD_NOT_ALLOWED,
                    "method_not_allowed",
                    "静的ファイルへのPOSTは利用できません。",
                )
            return

        content_type = self.headers.get("Content-Type", "")
        if content_type.split(";", 1)[0].strip().casefold() != "application/json":
            self._send_api_error(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "Content-Type: application/json を指定してください。",
            )
            return

        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if origin and host and origin.rstrip("/") not in {
            f"http://{host}",
            f"https://{host}",
        }:
            self._send_api_error(
                HTTPStatus.FORBIDDEN,
                "origin_not_allowed",
                "別オリジンからのAPI呼び出しは許可されていません。",
            )
            return

        try:
            payload = self._read_json_object()
        except ApiRequestError as exc:
            self._send_api_error(exc.status, exc.code, str(exc))
            return

        service_method = getattr(self.service, method_name)
        self._run_service_call(service_method, payload)

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        path = urlsplit(self.path).path
        if not path.startswith("/api/"):
            self._send_api_error(
                HTTPStatus.NOT_FOUND,
                "not_found",
                "指定されたパスは存在しません。",
            )
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self._send_security_headers()
        self.end_headers()

    def _run_service_call(
        self,
        operation: Callable[..., Any],
        payload: dict[str, Any] | None = None,
    ) -> None:
        try:
            result = operation() if payload is None else operation(payload)
            self._send_json(HTTPStatus.OK, result)
        except (ValueError, KeyError, TypeError) as exc:
            self._send_api_error(
                HTTPStatus.BAD_REQUEST,
                "invalid_request",
                str(exc) or "入力内容を確認してください。",
            )
        except Exception as exc:  # pragma: no cover - last-resort API boundary
            self.log_error("service error: %s", exc)
            self._send_api_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "internal_error",
                "処理中にエラーが発生しました。時間をおいて再度お試しください。",
            )

    def _read_json_object(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ApiRequestError("Content-Lengthが必要です。")
        try:
            content_length = int(raw_length)
        except ValueError as exc:
            raise ApiRequestError("Content-Lengthが不正です。") from exc
        if content_length < 0 or content_length > MAX_REQUEST_BYTES:
            raise ApiRequestError(
                "リクエストが大きすぎます。",
                status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                code="request_too_large",
            )
        if content_length == 0:
            return {}

        raw_body = self.rfile.read(content_length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiRequestError("JSON形式のリクエストを送信してください。") from exc
        if not isinstance(payload, dict):
            raise ApiRequestError("JSONの最上位はオブジェクトである必要があります。")
        return payload

    def _serve_static(self, request_path: str) -> None:
        relative_path = unquote(request_path).lstrip("/") or "index.html"
        static_root = self.static_dir.resolve()
        requested_file = (static_root / relative_path).resolve()
        try:
            requested_file.relative_to(static_root)
        except ValueError:
            self._send_text(HTTPStatus.FORBIDDEN, "Forbidden")
            return

        if not requested_file.is_file():
            self._send_text(HTTPStatus.NOT_FOUND, "Not Found")
            return

        content_type, encoding = mimetypes.guess_type(str(requested_file))
        headers = {"Cache-Control": "no-cache"}
        if encoding:
            headers["Content-Encoding"] = encoding
        self._send_bytes(
            HTTPStatus.OK,
            requested_file.read_bytes(),
            content_type or "application/octet-stream",
            headers=headers,
        )

    def _send_json(self, status: HTTPStatus, payload: Any) -> None:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        self._send_bytes(
            status,
            body,
            "application/json; charset=utf-8",
            headers={"Cache-Control": "no-store"},
        )

    def _send_api_error(
        self,
        status: HTTPStatus,
        code: str,
        message: str,
    ) -> None:
        self._send_json(
            status,
            {
                "ok": False,
                "error": {
                    "code": code,
                    "message": message,
                },
            },
        )

    def _send_text(self, status: HTTPStatus, message: str) -> None:
        self._send_bytes(
            status,
            message.encode("utf-8"),
            "text/plain; charset=utf-8",
            headers={"Cache-Control": "no-cache"},
        )

    def _send_bytes(
        self,
        status: HTTPStatus,
        body: bytes,
        content_type: str,
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._send_security_headers()
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; connect-src 'self'; base-uri 'none'; "
            "form-action 'self'; frame-ancestors 'none'",
        )

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write(
            f"[{self.log_date_time_string()}] {self.address_string()} "
            f"{format % args}\n"
        )


def make_handler(
    service: ApplicationService,
    static_dir: Path = DEFAULT_STATIC_DIR,
) -> type[RecommenderRequestHandler]:
    """Bind shared application dependencies to a request handler class."""

    class BoundRecommenderRequestHandler(RecommenderRequestHandler):
        pass

    BoundRecommenderRequestHandler.service = service
    BoundRecommenderRequestHandler.static_dir = static_dir
    return BoundRecommenderRequestHandler


def create_server(
    service: ApplicationService,
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    static_dir: Path = DEFAULT_STATIC_DIR,
) -> ThreadingHTTPServer:
    """Create the server separately so tests can bind it to an ephemeral port."""

    return ThreadingHTTPServer((host, port), make_handler(service, static_dir))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PR企画レコメンドMVPを起動します。")
    parser.add_argument(
        "--host",
        default=os.getenv("PR_HOST", "127.0.0.1"),
        help="待受ホスト（既定: PR_HOST または 127.0.0.1）",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=os.getenv("PR_PORT", "8765"),
        help="待受ポート（既定: PR_PORT または 8765）",
    )
    parser.add_argument(
        "--static-dir",
        type=Path,
        default=DEFAULT_STATIC_DIR,
        help="静的ファイルのディレクトリ",
    )
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("--portには0から65535までの整数を指定してください。")
    if not args.static_dir.is_dir():
        parser.error(f"静的ファイルのディレクトリがありません: {args.static_dir}")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    service = build_service()
    server = create_server(
        service,
        host=args.host,
        port=args.port,
        static_dir=args.static_dir,
    )
    host, port = server.server_address[:2]
    print(f"PR企画レコメンドMVP: http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを停止します。", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
