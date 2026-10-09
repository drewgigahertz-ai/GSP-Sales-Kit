"""The old full-database backfill is intentionally disabled.

Deploy the Firestore change-log function with:
    firebase deploy --only functions

This captures future creates, updates, and deletes without reading every existing
document. Keep the existing SQLite database as the initial local baseline.
"""


def main():
    raise SystemExit(
        "Full Firestore backfill is disabled to prevent quota exhaustion. "
        "Deploy the change-log trigger with: firebase deploy --only functions"
    )


if __name__ == "__main__":
    main()