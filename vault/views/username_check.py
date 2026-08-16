"""Endpoints d'énumération d'usernames (proxy Sherlock)."""

from django.http import JsonResponse

from ..decorators import api_error, require_auth
from ..ratelimit import rate_limit
from ..username_check import check_username, check_usernames, sanitize_username

MAX_LIMIT = 300
DEFAULT_LIMIT = 60
MAX_NAMES = 12
DEFAULT_NAMES_LIMIT = 15
MAX_NAMES_LIMIT = 30


def _outcome_payload(outcome, username: str) -> dict:
    return {
        "username": username,
        "attempted": outcome.attempted,
        "checked": outcome.checked,
        "failed": outcome.failed,
        "found": outcome.found,
        "found_count": len(outcome.found),
        "not_found_count": len(outcome.not_found),
        "inconclusive_count": len(outcome.inconclusive),
    }


@rate_limit("username-check", limit=20, window_seconds=60)
@require_auth
def username_check(request):
    """GET /vault/username-check?username=…&limit=… — vérifie la présence d'un username."""
    username = (request.GET.get("username") or "").strip()
    name = sanitize_username(username)
    if not name:
        return api_error("Username invalide (3-30 caractères : lettres, chiffres, . _ -).")

    try:
        limit = int(request.GET.get("limit", DEFAULT_LIMIT))
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    limit = max(1, min(limit, MAX_LIMIT))

    outcome = check_username(name, limit=limit)
    return JsonResponse(_outcome_payload(outcome, name))


@rate_limit("username-check", limit=20, window_seconds=60)
@require_auth
def usernames_check(request):
    """GET /vault/usernames-check?usernames=a,b,c&limit=… — vérifie plusieurs usernames (1 requête)."""
    raw = (request.GET.get("usernames") or "").split(",")
    names = [u.strip() for u in raw if u.strip()][:MAX_NAMES]
    if not names:
        return api_error("Usernames invalides.")

    try:
        limit = int(request.GET.get("limit", DEFAULT_NAMES_LIMIT))
    except (TypeError, ValueError):
        limit = DEFAULT_NAMES_LIMIT
    limit = max(1, min(limit, MAX_NAMES_LIMIT))

    outcomes = check_usernames(names, limit=limit)
    return JsonResponse(
        {
            "usernames": [_outcome_payload(outcomes[u], u) for u in outcomes],
            "sites_per_name": limit,
        }
    )