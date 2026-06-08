from __future__ import annotations

import json
import logging
import re
import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from threading import Lock

from app.core.config import settings

logger = logging.getLogger(__name__)
AUTH_LINK_RE = re.compile(r"https?://[^\s<>\"]+")
DEV_OUTBOX_LIMIT = 100
DEV_OUTBOX_PATH = Path(".local-data/dev-auth-emails.json")
_dev_auth_email_lock = Lock()


class EmailDeliveryError(Exception):
    pass


def is_dev_auth_email_inbox_enabled() -> bool:
    return settings.app_env != "production" and settings.email_mode == "log"


def _infer_email_type(subject: str) -> str:
    normalized = subject.lower()
    if "reset" in normalized:
        return "password_reset"
    if "verify" in normalized or "verification" in normalized:
        return "verification"
    return "other"


def _extract_first_link(text_body: str) -> str | None:
    match = AUTH_LINK_RE.search(text_body)
    return match.group(0).rstrip(".,)") if match else None


def _coerce_dev_email_item(value: object) -> dict[str, str | None] | None:
    if not isinstance(value, dict):
        return None

    allowed_keys = {
        "id",
        "to",
        "subject",
        "type",
        "createdAt",
        "actionUrl",
        "body",
        "preview",
    }
    item: dict[str, str | None] = {}
    for key in allowed_keys:
        raw_value = value.get(key)
        if raw_value is None or isinstance(raw_value, str):
            item[key] = raw_value
        else:
            item[key] = str(raw_value)

    return item


def _read_dev_auth_email_outbox() -> list[dict[str, str | None]]:
    try:
        raw = DEV_OUTBOX_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    except OSError as exc:
        logger.warning("dev_auth_email_outbox_read_failed", extra={"reason": str(exc)})
        return []

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("dev_auth_email_outbox_json_invalid", extra={"reason": str(exc)})
        return []

    if not isinstance(payload, list):
        return []

    items: list[dict[str, str | None]] = []
    for entry in payload:
        item = _coerce_dev_email_item(entry)
        if item is not None:
            items.append(item)
    return items[:DEV_OUTBOX_LIMIT]


def _write_dev_auth_email_outbox(items: list[dict[str, str | None]]) -> None:
    try:
        DEV_OUTBOX_PATH.parent.mkdir(parents=True, exist_ok=True)
        DEV_OUTBOX_PATH.write_text(
            json.dumps(items[:DEV_OUTBOX_LIMIT], indent=2),
            encoding="utf-8",
        )
    except OSError as exc:
        logger.warning("dev_auth_email_outbox_write_failed", extra={"reason": str(exc)})


def capture_dev_auth_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    link: str | None = None,
    email_type: str | None = None,
) -> None:
    if not is_dev_auth_email_inbox_enabled():
        return

    now = datetime.now(UTC).isoformat()
    body = text_body.strip()
    item: dict[str, str | None] = {
        "id": now,
        "to": to_email,
        "subject": subject,
        "type": email_type or _infer_email_type(subject),
        "createdAt": now,
        "actionUrl": link or _extract_first_link(text_body),
        "body": body,
        "preview": body[:600],
    }
    with _dev_auth_email_lock:
        items = _read_dev_auth_email_outbox()
        items.insert(0, item)
        _write_dev_auth_email_outbox(items)


def list_dev_auth_emails() -> list[dict[str, str | None]]:
    if not is_dev_auth_email_inbox_enabled():
        return []
    with _dev_auth_email_lock:
        return [dict(item) for item in _read_dev_auth_email_outbox()]


def clear_dev_auth_emails() -> None:
    if not is_dev_auth_email_inbox_enabled():
        return
    with _dev_auth_email_lock:
        _write_dev_auth_email_outbox([])


def send_auth_email(*, to_email: str, subject: str, text_body: str) -> None:
    if settings.email_mode == "log":
        if settings.app_env == "production":
            raise EmailDeliveryError("Log email mode is disabled in production.")
        capture_dev_auth_email(to_email=to_email, subject=subject, text_body=text_body)
        print(f"[email:log] To: {to_email}\nSubject: {subject}\n\n{text_body}", flush=True)
        logger.info("auth_email_logged", extra={"to_email": to_email, "subject": subject})
        return

    if not settings.smtp_host or not settings.smtp_from_email:
        logger.error(
            "auth_email_config_missing",
            extra={"has_host": bool(settings.smtp_host), "has_from": bool(settings.smtp_from_email)},
        )
        raise EmailDeliveryError("SMTP email delivery is not configured.")

    message = EmailMessage()
    message["To"] = to_email
    message["From"] = settings.smtp_from_email
    message["Subject"] = subject
    message.set_content(text_body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
        logger.info("auth_email_sent", extra={"to_email": to_email, "subject": subject})
    except Exception as exc:  # pragma: no cover - external provider behavior
        logger.exception(
            "auth_email_delivery_failed",
            extra={"to_email": to_email, "subject": subject, "smtp_host": settings.smtp_host},
        )
        raise EmailDeliveryError("Could not send email.") from exc
