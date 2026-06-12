from ...config import get_settings
from .base import DescriptionGenerator, GuideMeta, RecordingMeta, StepContext, pick_label
from .template import TemplateDescriptionGenerator

__all__ = [
    "DescriptionGenerator",
    "GuideMeta",
    "RecordingMeta",
    "StepContext",
    "get_generator",
    "pick_label",
]


def get_generator(name: str | None = None) -> DescriptionGenerator:
    name = name or get_settings().generator
    if name == "template":
        return TemplateDescriptionGenerator()
    raise ValueError(f"Unknown generator: {name!r} (set SOPS_GENERATOR=template)")
