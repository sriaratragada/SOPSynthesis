import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Recording(Base):
    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_id)
    status: Mapped[str] = mapped_column(Text, default="recording")
    started_at: Mapped[datetime] = mapped_column(default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(default=None)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)

    events: Mapped[list["Event"]] = relationship(
        back_populates="recording", cascade="all, delete-orphan", order_by="Event.seq"
    )


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("recording_id", "seq"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_id)
    recording_id: Mapped[str] = mapped_column(ForeignKey("recordings.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(Text)
    ts: Mapped[int] = mapped_column(Integer)
    url: Mapped[str] = mapped_column(Text, default="")
    page_title: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    screenshot_id: Mapped[str | None] = mapped_column(ForeignKey("screenshots.id"), default=None)

    recording: Mapped[Recording] = relationship(back_populates="events")


class Screenshot(Base):
    __tablename__ = "screenshots"

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # sha256 of PNG bytes
    file_path: Mapped[str] = mapped_column(Text)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    dpr: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Guide(Base):
    __tablename__ = "guides"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(Text, default="Untitled guide")
    description: Mapped[str] = mapped_column(Text, default="")
    source_recording_id: Mapped[str | None] = mapped_column(
        ForeignKey("recordings.id", ondelete="SET NULL"), default=None
    )
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    steps: Mapped[list["Step"]] = relationship(
        back_populates="guide", cascade="all, delete-orphan", order_by="Step.position"
    )


class Step(Base):
    __tablename__ = "steps"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_id)
    guide_id: Mapped[str] = mapped_column(ForeignKey("guides.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    screenshot_id: Mapped[str | None] = mapped_column(ForeignKey("screenshots.id"), default=None)
    instruction_text: Mapped[str] = mapped_column(Text, default="")
    instruction_overridden: Mapped[bool] = mapped_column(Boolean, default=False)
    callout_type: Mapped[str | None] = mapped_column(Text, default=None)
    callout_text: Mapped[str | None] = mapped_column(Text, default=None)
    click: Mapped[dict | None] = mapped_column(JSON, default=None)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)

    guide: Mapped[Guide] = relationship(back_populates="steps")
