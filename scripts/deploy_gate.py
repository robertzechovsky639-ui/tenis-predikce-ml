"""Jestli běh Pages smí nahrát web, zálohu stavu a nasadit.

Push nasadí vždy. Cron a ruční refresh jen když mají checkout aktuálního main.
Když se origin/main nepodaří stáhnout, refresh se nasadí, ať desetiminutový rytmus nesekne.
"""
import sys


def allow_publish(event_name, checkout_sha, origin_sha="", fetch_ok=True):
    if event_name == "push":
        return True
    if not fetch_ok:
        return True
    return bool(checkout_sha) and origin_sha == checkout_sha


def main(argv):
    event, sha, origin, fetch_ok = argv[1], argv[2], argv[3], argv[4] != "false"
    return 0 if allow_publish(event, sha, origin, fetch_ok) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
