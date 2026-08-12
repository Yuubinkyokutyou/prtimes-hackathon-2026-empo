"""追加依存なしの埋め込み実装と、任意のOpenAI Embeddingsクライアント。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import unicodedata
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from typing import Any, Protocol, runtime_checkable


Vector = tuple[float, ...]
PGVECTOR_DIMENSIONS = 1536


@runtime_checkable
class Embedder(Protocol):
    """検索エンジンから利用する埋め込みの共通契約。"""

    @property
    def model_id(self) -> str: ...

    def embed_documents(self, texts: Sequence[str]) -> list[Vector]: ...

    def embed_query(self, text: str) -> Vector: ...


def _normalise_text(text: str) -> str:
    normalised = unicodedata.normalize("NFKC", text).casefold()
    # 日本語は空白で分かち書きされないため、文字n-gramでは記号と空白だけを除く。
    return "".join(
        character
        for character in normalised
        if not character.isspace()
        and unicodedata.category(character)[0] not in {"C", "P", "Z"}
    )


class HashingEmbedder:
    """日本語向け文字n-gramをfeature hashingする軽量埋め込み。

    学習済み意味モデルではないが、表記ゆれにある程度強く、完全オフラインで
    再現可能である。Pythonの ``hash()`` はプロセスごとに値が変わるため使わず、
    BLAKE2で次元と符号を決めている。
    """

    def __init__(
        self,
        dimensions: int = PGVECTOR_DIMENSIONS,
        ngram_range: tuple[int, int] = (1, 4),
    ) -> None:
        minimum, maximum = ngram_range
        if dimensions < 64:
            raise ValueError("dimensions は64以上にしてください")
        if minimum < 1 or maximum < minimum:
            raise ValueError("ngram_range は 1 <= min <= max で指定してください")
        self.dimensions = dimensions
        self.ngram_range = ngram_range

    @property
    def model_id(self) -> str:
        minimum, maximum = self.ngram_range
        return f"hashing-char-ja-v1-{self.dimensions}d-{minimum}-{maximum}gram"

    def embed(self, texts: Sequence[str]) -> list[Vector]:
        """``embed_documents`` の短い別名。"""

        return self.embed_documents(texts)

    def embed_documents(self, texts: Sequence[str]) -> list[Vector]:
        return [self._embed_one(text) for text in texts]

    def embed_query(self, text: str) -> Vector:
        return self._embed_one(text)

    def _embed_one(self, text: str) -> Vector:
        normalised = _normalise_text(text)
        values = [0.0] * self.dimensions
        if not normalised:
            return tuple(values)

        # 境界記号により、同じ部分文字列でも語頭・語末の一致を少し強くする。
        bounded = f"^{normalised}$"
        minimum, maximum = self.ngram_range
        for size in range(minimum, maximum + 1):
            if size > len(bounded):
                break
            # 長いn-gramは具体性が高いため少し強くする。
            weight = 1.0 + 0.15 * (size - minimum)
            for start in range(0, len(bounded) - size + 1):
                gram = bounded[start : start + size].encode("utf-8")
                digest = hashlib.blake2b(
                    gram,
                    digest_size=16,
                    person=b"pr-hash-ja-v1",
                ).digest()
                bucket = int.from_bytes(digest[:8], "little") % self.dimensions
                sign = 1.0 if digest[8] & 1 else -1.0
                values[bucket] += sign * weight

        norm = math.sqrt(sum(value * value for value in values))
        if norm == 0.0:
            return tuple(values)
        return tuple(value / norm for value in values)


class OpenAIEmbeddingError(RuntimeError):
    """OpenAI Embeddings APIの安全に表示できる呼び出しエラー。"""


class OpenAIEmbedder:
    """標準ライブラリの ``urllib`` だけで ``/v1/embeddings`` を呼ぶ。

    通信は ``embed_documents`` / ``embed_query`` を呼んだ時だけ発生する。
    ``urlopen`` を注入できるため、単体テストでは外部通信せず検証できる。
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = "text-embedding-3-small",
        base_url: str | None = None,
        timeout: float = 30.0,
        batch_size: int = 128,
        urlopen: Callable[..., Any] | None = None,
    ) -> None:
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        if not self.api_key.strip():
            raise OpenAIEmbeddingError(
                "OpenAI埋め込みを使うには OPENAI_API_KEY を設定してください。"
            )
        if not model.strip():
            raise ValueError("model を空にはできません")
        if timeout <= 0:
            raise ValueError("timeout は正数にしてください")
        if batch_size < 1:
            raise ValueError("batch_size は1以上にしてください")

        configured_base = base_url or os.getenv(
            "OPENAI_BASE_URL",
            "https://api.openai.com/v1",
        )
        endpoint = configured_base.rstrip("/")
        if not endpoint.endswith("/embeddings"):
            endpoint += "/embeddings"

        self.model = model
        self.endpoint = endpoint
        self.timeout = timeout
        self.batch_size = batch_size
        self._urlopen = urlopen or urllib.request.urlopen

    @property
    def model_id(self) -> str:
        return f"openai:{self.model}"

    def embed(self, texts: Sequence[str]) -> list[Vector]:
        return self.embed_documents(texts)

    def embed_documents(self, texts: Sequence[str]) -> list[Vector]:
        if not texts:
            return []
        vectors: list[Vector] = []
        for start in range(0, len(texts), self.batch_size):
            batch = list(texts[start : start + self.batch_size])
            vectors.extend(self._request_embeddings(batch))
        return vectors

    def embed_query(self, text: str) -> Vector:
        return self._request_embeddings([text])[0]

    def _request_embeddings(self, texts: list[str]) -> list[Vector]:
        payload = json.dumps(
            {"model": self.model, "input": texts},
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=payload,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "pr-planning-recommender/0.1",
            },
            method="POST",
        )

        try:
            with self._urlopen(request, timeout=self.timeout) as response:
                response_payload = response.read()
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")[:500]
            except Exception:  # pragma: no cover - エラー応答自体が壊れている場合
                detail = ""
            suffix = f": {detail}" if detail else ""
            raise OpenAIEmbeddingError(
                f"OpenAI Embeddings APIがHTTP {exc.code}を返しました{suffix}"
            ) from exc
        except urllib.error.URLError as exc:
            raise OpenAIEmbeddingError(
                f"OpenAI Embeddings APIへ接続できません: {exc.reason}"
            ) from exc
        except TimeoutError as exc:
            raise OpenAIEmbeddingError(
                "OpenAI Embeddings APIへの接続がタイムアウトしました"
            ) from exc

        try:
            decoded = json.loads(response_payload)
            items = sorted(decoded["data"], key=lambda item: item["index"])
            vectors = [tuple(float(value) for value in item["embedding"]) for item in items]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise OpenAIEmbeddingError(
                "OpenAI Embeddings APIの応答形式を解釈できません"
            ) from exc

        if len(vectors) != len(texts):
            raise OpenAIEmbeddingError(
                "OpenAI Embeddings APIの返却件数が入力件数と一致しません"
            )
        dimensions = {len(vector) for vector in vectors}
        if len(dimensions) != 1 or 0 in dimensions:
            raise OpenAIEmbeddingError("埋め込みベクトルの次元が不正です")
        if any(not math.isfinite(value) for vector in vectors for value in vector):
            raise OpenAIEmbeddingError("埋め込みベクトルに有限でない値があります")
        return vectors
