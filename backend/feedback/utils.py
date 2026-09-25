import hashlib


def get_client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR", "")


def device_fingerprint(request):
    """SHA-256 hash derived from client IP and User-Agent."""
    raw = f"{get_client_ip(request)}|{request.META.get('HTTP_USER_AGENT', '')}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def pad_length_for(max_id):
    """Digits needed to show every ID with zero padding, minimum 2 (85 -> 2, 1200 -> 4)."""
    return max(2, len(str(max_id or 0)))
