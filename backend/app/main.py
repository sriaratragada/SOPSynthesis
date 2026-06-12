from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routers import exports, guides, recordings, screenshots, steps
from .schemas import HealthResponse


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="SOPSynthesis API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(http://localhost:\d+|http://127\.0\.0\.1:\d+|chrome-extension://[a-z]{32})$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    return HealthResponse()


app.include_router(recordings.router)
app.include_router(guides.router)
app.include_router(steps.router)
app.include_router(screenshots.router)
app.include_router(exports.router)
