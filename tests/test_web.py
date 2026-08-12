from __future__ import annotations

import json
import threading
import unittest
import urllib.error
import urllib.request

from pr_recommender.web import create_server


class FakeService:
    def bootstrap(self):
        return {"mode": "demo", "companies": []}

    def search(self, payload):
        return {"results": [], "echo": payload}

    def recommendations(self, payload):
        return {"recommendations": [], "echo": payload}

    def ideas(self, payload):
        return {"ideas": [], "echo": payload}

    def plan(self, payload):
        return {"items": [], "echo": payload}


class WebServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = create_server(FakeService(), host="127.0.0.1", port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address[:2]
        self.base_url = f"http://{host}:{port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_health_and_bootstrap(self) -> None:
        with urllib.request.urlopen(self.base_url + "/api/health") as response:
            self.assertEqual(response.status, 200)
            self.assertTrue(json.load(response)["ok"])
        with urllib.request.urlopen(self.base_url + "/api/bootstrap") as response:
            self.assertEqual(json.load(response)["mode"], "demo")

    def test_search_post(self) -> None:
        request = urllib.request.Request(
            self.base_url + "/api/search",
            data=json.dumps({"company_id": 1}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            self.assertEqual(json.load(response)["echo"]["company_id"], 1)

    def test_recommendations_post(self) -> None:
        request = urllib.request.Request(
            self.base_url + "/api/recommendations",
            data=json.dumps({"company_id": 900001}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            self.assertEqual(json.load(response)["echo"]["company_id"], 900001)

    def test_post_requires_json_and_same_origin(self) -> None:
        wrong_type = urllib.request.Request(
            self.base_url + "/api/search",
            data=b"{}",
            headers={"Content-Type": "text/plain"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(wrong_type)
        self.assertEqual(caught.exception.code, 415)

        cross_origin = urllib.request.Request(
            self.base_url + "/api/search",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "Origin": "https://evil.example",
            },
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(cross_origin)
        self.assertEqual(caught.exception.code, 403)

    def test_static_index_and_not_found(self) -> None:
        with urllib.request.urlopen(self.base_url + "/") as response:
            self.assertIn("PR Compass", response.read().decode("utf-8"))
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.base_url + "/api/missing")
        self.assertEqual(caught.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
