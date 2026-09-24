from typing import Any
from pydantic import BaseModel

class LoginIn(BaseModel):
    username: str
    password: str

class LabCreate(BaseModel):
    code: str
    name: str

class CaseCreate(BaseModel):
    case_code: str
    patient_ref: str
    lab_id: int

class SampleCreate(BaseModel):
    sample_code: str
    case_id: int
    embryo_label: str
    sample_type: str = "embryo biopsy"

class TestCreate(BaseModel):
    case_id: int
    sample_id: int | None = None
    test_type: str
    result_status: str = "pending"
    notes: str | None = None

class KVValue(BaseModel):
    value: Any
