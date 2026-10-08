"""Outgoing email (SMTP). Configured in .env; with no SMTP_HOST nothing is sent and callers are told so."""
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from .config import settings

_ADDR = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


def configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def clean_addresses(*raw: str) -> list[str]:
    """Valid, de-duplicated addresses from fields that may hold several separated by , ; or whitespace."""
    out: list[str] = []
    for r in raw:
        for a in re.split(r"[,;\s]+", str(r or "")):
            a = a.strip()
            if a and _ADDR.match(a) and a.lower() not in (x.lower() for x in out):
                out.append(a)
    return out


def send(to: list[str], subject: str, text: str, html: str | None = None) -> None:
    msg = EmailMessage()
    msg["Subject"] = re.sub(r"[\r\n]+", " ", subject)[:200]
    msg["From"] = formataddr((settings.smtp_from_name, settings.smtp_from))
    msg["To"] = ", ".join(to)
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    mode = (settings.smtp_security or "starttls").lower()
    if mode == "ssl":
        server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20, context=ssl.create_default_context())
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
    with server:
        if mode == "starttls":
            server.starttls(context=ssl.create_default_context())
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)
