import base64

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=100)
    salt: str  # base64
    auth_verifier: str  # base64
    encrypted_vault_key: str  # base64
    public_key: str  # base64
    encrypted_private_key: str  # base64


class LoginRequest(BaseModel):
    email: EmailStr
    auth_verifier: str  # base64


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    display_name: str
    salt: str
    encrypted_vault_key: str
    public_key: str
    encrypted_private_key: str


class UserPublic(BaseModel):
    id: str
    email: str
    display_name: str
    public_key: str

    model_config = {"from_attributes": True}
