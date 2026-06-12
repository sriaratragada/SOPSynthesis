import io
import os
import tempfile

# Must be set before any `app` import: the engine binds to the data dir at import time.
os.environ.setdefault("SOPS_DATA_DIR", tempfile.mkdtemp(prefix="sops-test-"))

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture(scope="session")
def client():
    from app.main import app

    with TestClient(app) as test_client:  # context manager runs lifespan → init_db
        yield test_client


@pytest.fixture(scope="session")
def png_bytes() -> bytes:
    img = Image.new("RGB", (1280, 720), (240, 240, 245))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
