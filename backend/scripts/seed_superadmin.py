"""Promote a user to the superadmin role.

When V-Prep is first set up, no admins exist yet — this script bridges that
gap by promoting a specific user (identified by email) to superadmin directly
in MongoDB. The user must have signed in at least once (via mobile or admin)
so their account already exists.

Usage:
    python scripts/seed_superadmin.py admin@example.com
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python scripts/seed_superadmin.py <email>")
        sys.exit(1)

    email = sys.argv[1].strip().lower()

    mongodb_url = os.environ["MONGODB_URL"]
    db_name = os.environ.get("MONGODB_DB_NAME", "vprep")

    client = MongoClient(mongodb_url)
    try:
        db = client[db_name]
        user = db["users"].find_one({"email": email})

        if user is None:
            print(f"No user found with email '{email}'. Sign in once first, then re-run this script.")
            sys.exit(1)

        name = user.get("display_name", email)

        if user.get("role") == "superadmin":
            print(f"{name} <{email}> is already a superadmin. Nothing to do.")
            return

        db["users"].update_one({"_id": user["_id"]}, {"$set": {"role": "superadmin"}})
        print(f"Promoted {name} <{email}> to superadmin.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
