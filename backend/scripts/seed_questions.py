"""Seed the `questions` collection with the Phase 5 mock-interview question bank.

Standalone script — connects to MongoDB directly with pymongo (synchronous,
simpler for one-off scripts; same approach as scripts/seed_superadmin.py) and
loads `.env` the same way. Run once after deploying Phase 5:

    python scripts/seed_questions.py

If the `questions` collection already has documents, prints "Questions already
seeded" and exits without inserting anything — safe to re-run.

Judgment call: the Phase 5 file tree lists this as `app/scripts/seed_questions.py`,
but the repo's existing seed script lives at `backend/scripts/seed_superadmin.py`
(not `backend/app/scripts/`) — and the spec's own usage line for THIS script
("Standalone Python script (run with `python scripts/seed_questions.py`)")
matches that real location, not the file-tree path. Following the existing
convention (and the spec's own run command) rather than introducing a second,
inconsistent scripts directory.
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


# ---------------------------------------------------------------------------
# Question bank — written out fully per the spec ("these are the actual
# question texts to use"). HR and Behavioral are track-agnostic (track_id
# "all"); Technical questions are split per track.
# ---------------------------------------------------------------------------

HR_SCORING_CRITERIA = ["clarity", "relevance", "fluency", "confidence"]
BEHAVIORAL_SCORING_CRITERIA = ["structure", "example_quality", "self_awareness", "impact"]
TECHNICAL_SCORING_CRITERIA = ["accuracy", "depth", "practical_knowledge"]
CODING_LOGIC_SCORING_CRITERIA = ["logic_correctness", "edge_cases", "complexity_awareness", "clarity"]

HR_QUESTIONS = [
    "Tell me about yourself and what drives you toward this field.",
    "Why are you interested in this role and what do you hope to learn?",
    "Describe a challenge you faced in a project and how you resolved it.",
    "Where do you see yourself professionally in the next two to three years?",
    "How do you approach learning a new technology or concept you are unfamiliar with?",
]

BEHAVIORAL_QUESTIONS = [
    "Tell me about a time you had to work under pressure to meet a deadline.",
    "Describe a situation where you disagreed with a team member. How did you handle it?",
    "Give an example of a project where you took initiative beyond your assigned role.",
    "Tell me about a time you received critical feedback. How did you respond?",
    "Describe a situation where you had to quickly learn something new to complete a task.",
]

TECHNICAL_QUESTIONS_BY_TRACK: dict[str, list[str]] = {
    "ml_ai": [
        "Explain the bias-variance tradeoff and how it affects model selection.",
        "What is the difference between L1 and L2 regularization? When would you use each?",
        "How does backpropagation work in a neural network?",
        "Explain how you would handle a highly imbalanced dataset in a classification task.",
        "What is attention mechanism in transformers and why was it a breakthrough?",
        "Describe the steps you take to evaluate and validate a machine learning model.",
    ],
    "web_dev": [
        "Explain the difference between server-side rendering, client-side rendering, and static site generation.",
        "How does the JavaScript event loop work? Explain with an example.",
        "What is the difference between authentication and authorization? How would you implement both?",
        "Explain RESTful API design principles and what makes an API RESTful.",
        "How do you approach optimizing the performance of a slow web application?",
        "What is CORS and how do you handle it in a web application?",
    ],
    "devops": [
        "Explain the difference between a container and a virtual machine.",
        "Describe how you would design a CI/CD pipeline for a production application.",
        "What is infrastructure as code and why is it important?",
        "How does Kubernetes manage container scheduling and scaling?",
        "Explain the blue-green deployment strategy and when you would use it.",
        "What monitoring and alerting strategies do you use for production systems?",
    ],
    "data_science": [
        "Walk me through how you would approach a new data analysis project from start to finish.",
        "Explain the difference between correlation and causation with an example.",
        "How do you handle missing data in a dataset? What are your strategies?",
        "What is the Central Limit Theorem and why is it important in statistics?",
        "Explain A/B testing: how you would design one and interpret the results.",
        "How would you communicate a complex data finding to a non-technical stakeholder?",
    ],
    "cloud": [
        "Explain the shared responsibility model in cloud computing.",
        "What is the difference between vertical and horizontal scaling? When do you use each?",
        "How would you design a highly available architecture on a cloud platform?",
        "Explain the concept of serverless computing and its trade-offs.",
        "How do you manage secrets and credentials securely in a cloud environment?",
        "What strategies do you use to optimize cloud infrastructure costs?",
    ],
    "mobile_dev": [
        "Explain the React Native bridge and how it differs from the new architecture.",
        "How do you manage app state in a complex mobile application?",
        "What are the key differences between developing for iOS and Android?",
        "How do you optimize the performance of a React Native app that feels slow?",
        "Explain how push notifications work end-to-end on mobile platforms.",
        "What is your approach to handling offline functionality in a mobile app?",
    ],
}

CODING_LOGIC_QUESTIONS_BY_TRACK: dict[str, list[str]] = {
    "ml_ai": [
        "Handwrite pseudocode for finding the top-k most frequent labels in a dataset stream. Include the data structures you would use and the time complexity.",
        "Handwrite the logic for splitting a dataset into train/validation/test sets while preserving class balance. Mention edge cases.",
    ],
    "web_dev": [
        "Handwrite pseudocode for rate limiting login attempts per user and IP address. Include how expired attempts are cleaned up.",
        "Handwrite the logic for merging paginated API results while avoiding duplicate records and preserving order.",
    ],
    "devops": [
        "Handwrite a deployment rollback decision flow for a failed production release. Include health checks and traffic switching.",
        "Handwrite pseudocode for detecting a service that is flapping based on recent health-check results.",
    ],
    "data_science": [
        "Handwrite pseudocode to detect and cap outliers in a numeric column using the IQR method. Include how null values are handled.",
        "Handwrite the logic for computing precision, recall, and F1 from a confusion matrix.",
    ],
    "cloud": [
        "Handwrite a decision flow for routing requests across healthy instances in multiple availability zones.",
        "Handwrite pseudocode for rotating an application secret without downtime.",
    ],
    "mobile_dev": [
        "Handwrite pseudocode for an offline-first sync queue that retries failed API writes safely.",
        "Handwrite the logic for debouncing a search input and cancelling stale requests in a mobile app.",
    ],
}

# Difficulty + tags aren't specified per-question by the spec — assigning a
# simple, even easy/medium/hard spread (mirrors assessment_service's
# increasing-difficulty philosophy) and a single descriptive tag per phase
# keeps every required field populated without inventing meaningfully
# different metadata the spec never asked for.
_DIFFICULTY_CYCLE = ["easy", "medium", "hard"]


def _difficulty_for(index: int) -> str:
    return _DIFFICULTY_CYCLE[index % len(_DIFFICULTY_CYCLE)]


def _build_documents() -> list[dict]:
    documents: list[dict] = []

    for index, question_text in enumerate(HR_QUESTIONS):
        documents.append({
            "track_id": "all",
            "phase": "hr",
            "question_text": question_text,
            "answer_type": "voice",
            "difficulty": _difficulty_for(index),
            "scoring_criteria": HR_SCORING_CRITERIA,
            "model_answer": (
                "A concise, well-structured spoken answer that directly addresses "
                "the question, stays on topic, and reflects genuine self-awareness "
                "and motivation rather than rehearsed buzzwords."
            ),
            "tags": ["hr", "screening"],
        })

    for index, question_text in enumerate(BEHAVIORAL_QUESTIONS):
        documents.append({
            "track_id": "all",
            "phase": "behavioral",
            "question_text": question_text,
            "answer_type": "voice",
            "difficulty": _difficulty_for(index),
            "scoring_criteria": BEHAVIORAL_SCORING_CRITERIA,
            "model_answer": (
                "A clearly structured story (ideally following Situation, Task, "
                "Action, Result) that names a specific real example, explains the "
                "candidate's own actions and reasoning, and closes with a concrete, "
                "honestly-assessed outcome or lesson learned."
            ),
            "tags": ["behavioral", "star-method"],
        })

    for track_id, questions in TECHNICAL_QUESTIONS_BY_TRACK.items():
        for index, question_text in enumerate(questions):
            documents.append({
                "track_id": track_id,
                "phase": "technical",
                "question_text": question_text,
                "answer_type": "text",
                "difficulty": _difficulty_for(index),
                "scoring_criteria": TECHNICAL_SCORING_CRITERIA,
                "model_answer": (
                    "A technically accurate, appropriately detailed explanation that "
                    "uses correct terminology, addresses the core of the question "
                    "directly, and — where relevant — grounds the explanation in "
                    "practical, real-world experience rather than textbook recall."
                ),
                "tags": ["technical", track_id],
            })

    for track_id, questions in CODING_LOGIC_QUESTIONS_BY_TRACK.items():
        for index, question_text in enumerate(questions):
            documents.append({
                "track_id": track_id,
                "phase": "coding_logic",
                "question_text": question_text,
                "answer_type": "image",
                "difficulty": _difficulty_for(index + 1),
                "scoring_criteria": CODING_LOGIC_SCORING_CRITERIA,
                "model_answer": (
                    "A strong handwritten solution should present clear algorithmic "
                    "steps or pseudocode, use appropriate data structures, address "
                    "important edge cases, and explain time/space complexity where "
                    "relevant. The exact syntax is less important than correct logic."
                ),
                "tags": ["coding_logic", track_id, "handwritten"],
            })

    return documents


def main() -> None:
    mongodb_url = os.environ["MONGODB_URL"]
    db_name = os.environ.get("MONGODB_DB_NAME", "vprep")

    client = MongoClient(mongodb_url)
    try:
        db = client[db_name]
        collection = db["questions"]

        documents = _build_documents()
        if collection.estimated_document_count() > 0:
            existing_keys = {
                (doc.get("track_id"), doc.get("phase"), doc.get("question_text"))
                for doc in collection.find({}, {"track_id": 1, "phase": 1, "question_text": 1})
            }
            missing_documents = [
                doc for doc in documents
                if (doc["track_id"], doc["phase"], doc["question_text"]) not in existing_keys
            ]
            if not missing_documents:
                print("Questions already seeded")
                return
            collection.insert_many(missing_documents)
            print(f"Added {len(missing_documents)} missing questions into '{db_name}.questions'.")
            return

        collection.insert_many(documents)
        print(f"Seeded {len(documents)} questions into '{db_name}.questions'.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
