from pydantic import BaseModel, Field


class EntryCreateRequest(BaseModel):
    encrypted_data: str  # base64


class EntryUpdateRequest(BaseModel):
    encrypted_data: str  # base64


class EntryResponse(BaseModel):
    id: str
    owner_id: str
    encrypted_data: str  # base64
    created_at: str
    updated_at: str


class GeneratePasswordRequest(BaseModel):
    length: int = Field(default=20, ge=12, le=64)


class GeneratePasswordResponse(BaseModel):
    password: str
