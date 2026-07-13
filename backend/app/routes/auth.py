from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import create_access_token
from ..database import get_db
from ..dependencies import b64_decode, b64_encode
from ..models.user import User
from ..schemas.auth import AuthResponse, LoginRequest, RegisterRequest

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == request.email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email déjà utilisé")

    user = User(
        email=request.email,
        display_name=request.display_name,
        salt=b64_decode(request.salt),
        auth_verifier=b64_decode(request.auth_verifier),
        encrypted_vault_key=b64_decode(request.encrypted_vault_key),
        public_key=b64_decode(request.public_key),
        encrypted_private_key=b64_decode(request.encrypted_private_key),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.email)
    return AuthResponse(
        access_token=token,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        salt=b64_encode(user.salt),
        encrypted_vault_key=b64_encode(user.encrypted_vault_key),
        public_key=b64_encode(user.public_key),
        encrypted_private_key=b64_encode(user.encrypted_private_key),
    )


@router.post("/login", response_model=AuthResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides")

    verifier = b64_decode(request.auth_verifier)
    if verifier != user.auth_verifier:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides")

    token = create_access_token(user.id, user.email)
    return AuthResponse(
        access_token=token,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        salt=b64_encode(user.salt),
        encrypted_vault_key=b64_encode(user.encrypted_vault_key),
        public_key=b64_encode(user.public_key),
        encrypted_private_key=b64_encode(user.encrypted_private_key),
    )


@router.get("/salt")
def get_salt(email: str, db: Session = Depends(get_db)):
    """Retourne le salt d'un utilisateur (nécessaire pour la dérivation côté client)."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utilisateur introuvable")
    return {"salt": b64_encode(user.salt)}
