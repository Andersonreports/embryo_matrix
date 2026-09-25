from datetime import datetime
from typing import Any
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

class Lab(Base):
    __tablename__ = "labs"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(30), default="lab_user")
    lab_id: Mapped[int | None] = mapped_column(ForeignKey("labs.id"), nullable=True)
    lab = relationship("Lab")

class PatientCase(Base):
    __tablename__ = "patient_cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    patient_ref: Mapped[str] = mapped_column(String(120))
    lab_id: Mapped[int] = mapped_column(ForeignKey("labs.id"), index=True)
    status: Mapped[str] = mapped_column(String(40), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class EmbryoSample(Base):
    __tablename__ = "embryo_samples"
    id: Mapped[int] = mapped_column(primary_key=True)
    sample_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("patient_cases.id"), index=True)
    embryo_label: Mapped[str] = mapped_column(String(80))
    sample_type: Mapped[str] = mapped_column(String(60), default="embryo biopsy")
    status: Mapped[str] = mapped_column(String(40), default="received")

class PGTTest(Base):
    __tablename__ = "pgt_tests"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("patient_cases.id"), index=True)
    sample_id: Mapped[int | None] = mapped_column(ForeignKey("embryo_samples.id"), nullable=True)
    test_type: Mapped[str] = mapped_column(String(40))
    result_status: Mapped[str] = mapped_column(String(40), default="pending")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(120))
    entity: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class KVStore(Base):
    """Server-side replacement for the frontend's localStorage: one JSON blob per key."""
    __tablename__ = "kv_store"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class CaseImage(Base):
    __tablename__ = "case_images"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_code: Mapped[str] = mapped_column(String(80), index=True)
    embryo_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    file_path: Mapped[str] = mapped_column(String(500))
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class ProtocolDocument(Base):
    __tablename__ = "protocol_documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    file_path: Mapped[str] = mapped_column(String(500))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class ActivityLog(Base):
    """Who did what, when. Written server-side from the login token."""
    __tablename__ = "activity_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    username: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(40), default="")
    action: Mapped[str] = mapped_column(String(40), index=True)
    detail: Mapped[str] = mapped_column(Text, default="")
