from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SOPS_")

    data_dir: Path = Path("data")
    generator: str = "template"
    marker_color: str = "#FF5C35"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "sops.db"

    @property
    def screenshots_dir(self) -> Path:
        return self.data_dir / "screenshots"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.screenshots_dir.mkdir(parents=True, exist_ok=True)
    return settings
