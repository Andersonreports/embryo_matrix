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
    # The name this person goes by in the sheets' Embryologist column - used to show an embryologist their own embryos.
    embryologist_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # For a login that represents a fertility centre: any patient whose centre name contains this text is listed for them.
    client_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
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

class CaseRunAssignment(Base):
    """Manually assigns a sequencing run to a case (loose case_code string, same
    key CaseImage/TrfSubmission use - real case identity lives in the sheet-synced
    data, not the mostly-unused PatientCase table above). This only drives file
    organization - e.g. moving a case's TRF/images out of staging into a run
    folder on the lab PC - it's separate from the sheet-derived run matching
    used for reporting."""
    __tablename__ = "case_run_assignments"
    case_code: Mapped[str] = mapped_column(String(80), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(30))
    assigned_by: Mapped[str] = mapped_column(String(120), default="")
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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

class TrfSubmission(Base):
    """A digital PGT test requisition form submitted by a clinic from the public /trf page.
    The whole form is kept as JSON; the columns below are copies used for listing."""
    __tablename__ = "trf_submissions"
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    status: Mapped[str] = mapped_column(String(20), default="New", index=True)
    clinic: Mapped[str] = mapped_column(String(255), default="")
    patient_name: Mapped[str] = mapped_column(String(255), default="")
    data: Mapped[Any] = mapped_column(JSON)
    status_by: Mapped[str] = mapped_column(String(120), default="")
    status_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Set by a lab user manually linking this submission to a case (no reliable
    # automatic match - patient_name is free text typed by the clinic).
    case_code: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    pdf_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pdf_file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Remark the approver typed when approving / rejecting.
    status_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Login that submitted the form, and the patient-signed scanned copy uploaded afterwards.
    submitted_by: Mapped[str] = mapped_column(String(120), default="")
    signed_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    signed_file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    signed_by: Mapped[str] = mapped_column(String(120), default="")

class ActivityLog(Base):
    """Who did what, when. Written server-side from the login token."""
    __tablename__ = "activity_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    username: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(40), default="")
    action: Mapped[str] = mapped_column(String(40), index=True)
    detail: Mapped[str] = mapped_column(Text, default="")

class Followup(Base):
    """Clinical outcome follow-up for one patient case. case_key is the sheet case id once known, else "trf:<TRF ref>".
    Patient / clinic / embryo fields are a snapshot taken when the record is created or saved, so the follow-up
    pages and dashboard need no access to the sample sheet."""
    __tablename__ = "followups"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(10), default="manual")  # "trf" | "manual"
    trf_ref: Mapped[str | None] = mapped_column(String(30), nullable=True)
    patient: Mapped[str] = mapped_column(String(255), default="")
    clinic: Mapped[str] = mapped_column(String(255), default="")
    region: Mapped[str] = mapped_column(String(120), default="")
    embryologist: Mapped[str] = mapped_column(String(120), default="")
    test: Mapped[str] = mapped_column(String(255), default="")
    month: Mapped[str] = mapped_column(String(20), default="")
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embryos: Mapped[Any] = mapped_column(JSON, default=list)  # [{"label": "SB-1", "result": "Euploid"}]
    consent: Mapped[str] = mapped_column(String(3), default="Yes")  # "Yes" | "No"
    contact_name: Mapped[str] = mapped_column(String(255), default="")
    contact_detail: Mapped[str] = mapped_column(String(255), default="")
    expected_period: Mapped[str] = mapped_column(String(60), default="")
    due_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    state: Mapped[str] = mapped_column(String(20), default="")  # "" | awaiting | completed | not_applicable
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_by: Mapped[str] = mapped_column(String(120), default="")
    owner: Mapped[str] = mapped_column(String(120), default="")  # login that submitted the TRF this came from

class EmbryoOutcome(Base):
    __tablename__ = "embryo_outcomes"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_key: Mapped[str] = mapped_column(String(120), index=True)
    embryo_label: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(40), default="")
    event_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    # Further tests on this embryo after PGT-A: {"tera": {"where","lab","date","result","note"}, "nips": {...}}
    tests: Mapped[Any] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_by: Mapped[str] = mapped_column(String(120), default="")

class OutcomeHistory(Base):
    """Every change to an embryo's outcome, newest last: what it was set to, by whom and when."""
    __tablename__ = "outcome_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_key: Mapped[str] = mapped_column(String(120), index=True)
    embryo_label: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(40), default="")
    previous_status: Mapped[str] = mapped_column(String(40), default="")
    event_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    tests: Mapped[Any] = mapped_column(JSON, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    changed_by: Mapped[str] = mapped_column(String(120), default="")
