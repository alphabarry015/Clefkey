from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..crypto.password_gen import generate_password
from ..database import get_db
from ..dependencies import b64_decode, b64_encode, get_current_user
from ..models.user import User
from ..models.vault_entry import VaultEntry
from ..schemas.vault import (
    EntryCreateRequest,
    EntryResponse,
    EntryUpdateRequest,
    GeneratePasswordRequest,
    GeneratePasswordResponse,
)

router = APIRouter(prefix="/vault", tags=["vault"])


def _entry_to_response(entry: VaultEntry) -> EntryResponse:
    return EntryResponse(
        id=entry.id,
        owner_id=entry.owner_id,
        encrypted_data=b64_encode(entry.encrypted_data),
        created_at=entry.created_at.isoformat(),
        updated_at=entry.updated_at.isoformat(),
    )


@router.get("/entries", response_model=list[EntryResponse])
def list_entries(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entries = db.query(VaultEntry).filter(VaultEntry.owner_id == current_user.id).all()
    return [_entry_to_response(entry) for entry in entries]


@router.post("/entries", response_model=EntryResponse, status_code=status.HTTP_201_CREATED)
def create_entry(
    request: EntryCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = VaultEntry(
        owner_id=current_user.id,
        encrypted_data=b64_decode(request.encrypted_data),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _entry_to_response(entry)


@router.get("/entries/{entry_id}", response_model=EntryResponse)
def get_entry(
    entry_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = db.query(VaultEntry).filter(VaultEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entrée introuvable")
    if entry.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé")
    return _entry_to_response(entry)


@router.put("/entries/{entry_id}", response_model=EntryResponse)
def update_entry(
    entry_id: str,
    request: EntryUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = db.query(VaultEntry).filter(VaultEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entrée introuvable")
    if entry.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Modification interdite")

    entry.encrypted_data = b64_decode(request.encrypted_data)
    db.commit()
    db.refresh(entry)
    return _entry_to_response(entry)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = db.query(VaultEntry).filter(VaultEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entrée introuvable")
    if entry.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Suppression interdite")

    db.delete(entry)
    db.commit()


@router.post("/generate-password", response_model=GeneratePasswordResponse)
def generate_password_endpoint(
    request: GeneratePasswordRequest,
    _current_user: User = Depends(get_current_user),
):
    return GeneratePasswordResponse(password=generate_password(request.length))
