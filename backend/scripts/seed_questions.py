"""Seed or refresh the professional mock-interview question bank.

Run from ``vprep/backend`` with:

    python scripts/seed_questions.py

The script is intentionally non-destructive. It upserts the current professional
bank by stable ``question_key`` values and leaves historical/older question
documents in place so completed sessions remain intact.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


PROFESSIONAL_BANK_VERSION = "professional_v2"

HR_SCORING_CRITERIA = [
    "communication_clarity",
    "role_motivation",
    "self_awareness",
    "specificity",
    "professionalism",
]
BEHAVIORAL_SCORING_CRITERIA = [
    "star_structure",
    "ownership",
    "impact",
    "reflection",
    "collaboration_judgment",
]
TECHNICAL_SCORING_CRITERIA = [
    "technical_correctness",
    "depth_of_reasoning",
    "practical_tradeoffs",
    "implementation_awareness",
    "terminology",
]
CODING_LOGIC_SCORING_CRITERIA = [
    "problem_decomposition",
    "algorithm_correctness",
    "edge_cases",
    "complexity_awareness",
    "clarity",
]


HR_QUESTIONS: list[dict[str, Any]] = [
    {
        "difficulty": "easy",
        "question_text": "Walk me through your background as if this were the first five minutes of a professional interview. What should I remember about you for this role?",
        "model_answer": "A strong answer gives a focused career or learning summary, connects experience to the target role, names one or two relevant strengths, and avoids a long personal biography.",
        "tags": ["hr", "introduction", "role-fit"],
    },
    {
        "difficulty": "easy",
        "question_text": "What attracted you to this role, and what recent learning, project work, or practice shows you are preparing seriously for it?",
        "model_answer": "A strong answer links motivation to the role's real responsibilities, cites concrete preparation evidence, and shows realistic understanding of the field.",
        "tags": ["hr", "motivation", "preparation"],
    },
    {
        "difficulty": "medium",
        "question_text": "Tell me about one technical strength you would bring to a team and one skill gap you are actively improving. How are you measuring progress?",
        "model_answer": "A strong answer is honest and specific, gives evidence for the strength, names a real improvement plan, and explains a measurable progress signal.",
        "tags": ["hr", "self-awareness", "growth"],
    },
    {
        "difficulty": "medium",
        "question_text": "Describe how you would explain a complex technical decision to a non-technical stakeholder who needs a quick recommendation.",
        "model_answer": "A strong answer simplifies without distorting, frames tradeoffs in business or user terms, gives a recommendation, and checks for understanding.",
        "tags": ["hr", "communication", "stakeholders"],
    },
    {
        "difficulty": "medium",
        "question_text": "When joining a new team or project, how do you build context quickly without slowing other people down?",
        "model_answer": "A strong answer mentions reading existing docs/code, asking targeted questions, pairing or observing, validating assumptions, and contributing small useful work early.",
        "tags": ["hr", "teamwork", "onboarding"],
    },
    {
        "difficulty": "hard",
        "question_text": "Imagine the interviewer challenges a claim on your CV or portfolio. How would you respond professionally and back it up with evidence?",
        "model_answer": "A strong answer stays calm, clarifies the claim, gives concrete evidence or scope, admits limits honestly, and redirects to what they can demonstrate.",
        "tags": ["hr", "credibility", "pressure"],
    },
    {
        "difficulty": "hard",
        "question_text": "If you had 90 days in this role, what outcomes would you prioritize and how would you know you were succeeding?",
        "model_answer": "A strong answer identifies learning, delivery, collaboration, and measurable outcomes; it balances ambition with realistic ramp-up and team alignment.",
        "tags": ["hr", "planning", "impact"],
    },
    {
        "difficulty": "hard",
        "question_text": "Tell me about a moment when your communication changed the direction or outcome of a project, review, or team discussion.",
        "model_answer": "A strong answer names the context, explains what was communicated and why, shows the candidate's ownership, and states a concrete outcome or lesson.",
        "tags": ["hr", "communication", "impact"],
    },
]


BEHAVIORAL_QUESTIONS: list[dict[str, Any]] = [
    {
        "difficulty": "easy",
        "question_text": "Tell me about a time you received critical feedback on your work. What did you change afterward?",
        "model_answer": "A strong STAR answer gives the situation, the feedback, the candidate's response, the change made, and evidence that the change improved later work.",
        "tags": ["behavioral", "feedback", "growth"],
    },
    {
        "difficulty": "easy",
        "question_text": "Describe a time you had to learn something unfamiliar quickly to complete a task or project.",
        "model_answer": "A strong answer shows how the candidate scoped the learning, used reliable resources, asked for help appropriately, applied the skill, and reflected on the result.",
        "tags": ["behavioral", "learning", "adaptability"],
    },
    {
        "difficulty": "medium",
        "question_text": "Tell me about a deadline that became risky. How did you communicate, prioritize, and protect quality?",
        "model_answer": "A strong answer explains the constraint, tradeoffs, communication with stakeholders, priority decisions, quality safeguards, and final outcome.",
        "tags": ["behavioral", "deadlines", "prioritization"],
    },
    {
        "difficulty": "medium",
        "question_text": "Describe a disagreement with a teammate about a technical or delivery decision. How did you handle it?",
        "model_answer": "A strong answer separates facts from opinions, listens actively, uses evidence or experiments, keeps the relationship professional, and reaches a decision.",
        "tags": ["behavioral", "conflict", "collaboration"],
    },
    {
        "difficulty": "medium",
        "question_text": "Tell me about a time you took ownership of a problem that was not clearly assigned to anyone.",
        "model_answer": "A strong answer shows initiative, clear boundaries, communication with affected people, concrete action, and impact without exaggerating credit.",
        "tags": ["behavioral", "ownership", "initiative"],
    },
    {
        "difficulty": "hard",
        "question_text": "Describe a situation where you had to make a tradeoff between speed, quality, and scope. What did you choose and why?",
        "model_answer": "A strong answer names the constraints, evaluates options, explains the chosen tradeoff, communicates risk, and reflects on the outcome.",
        "tags": ["behavioral", "tradeoffs", "judgment"],
    },
    {
        "difficulty": "hard",
        "question_text": "Tell me about a mistake that affected another person or team. How did you repair trust and prevent recurrence?",
        "model_answer": "A strong answer takes responsibility, explains immediate mitigation, communicates transparently, changes process or checks, and avoids blaming others.",
        "tags": ["behavioral", "accountability", "trust"],
    },
    {
        "difficulty": "hard",
        "question_text": "Give an example of how you handled ambiguity when requirements, data, or expectations were incomplete.",
        "model_answer": "A strong answer shows how the candidate clarified goals, identified assumptions, created a reversible plan, sought feedback, and adapted based on evidence.",
        "tags": ["behavioral", "ambiguity", "problem-solving"],
    },
]


TECHNICAL_QUESTIONS_BY_TRACK: dict[str, list[tuple[str, str, str, str]]] = {
    "ml_ai": [
        ("easy", "machine learning", "When would you choose a simple baseline model over a deep learning model for a new ML problem?", "A strong answer values baselines for speed, interpretability, debugging, and data-size constraints before adding model complexity."),
        ("easy", "model evaluation", "Explain train/validation/test splitting to a junior teammate. What kinds of leakage would make the evaluation misleading?", "A strong answer separates tuning from final evaluation and names leakage from duplicated records, future information, target-derived features, and preprocessing fit on all data."),
        ("easy", "feature engineering", "How would you decide whether a feature should be transformed, removed, or kept as-is before training a model?", "A strong answer considers signal, distribution, missingness, leakage risk, domain meaning, correlation with target, and validation impact."),
        ("medium", "model evaluation", "A classifier has high recall but poor precision. How would you diagnose the problem and improve it without blindly changing models?", "A strong answer checks thresholds, class balance, labels, false positives, calibration, costs, feature quality, and validation slices before choosing changes."),
        ("medium", "deep learning", "What practical signs tell you that a neural network is overfitting, and what interventions would you try first?", "A strong answer compares train/validation curves and tries data augmentation, regularization, early stopping, simpler architecture, and cleaner validation."),
        ("medium", "model deployment", "After deployment, model performance starts drifting. What signals would you monitor and what first actions would you take?", "A strong answer monitors input distribution, prediction distribution, data quality, latency, business metrics, labels when available, and has rollback/retraining checks."),
        ("hard", "NLP", "For a retrieval-augmented assistant, how would you evaluate answer quality beyond simple exact-match accuracy?", "A strong answer covers retrieval relevance, faithfulness, citation grounding, hallucination rate, latency, user task success, human review, and regression test sets."),
        ("hard", "model deployment", "Design a safe rollout plan for an ML model that may affect user-facing decisions. What guardrails matter?", "A strong answer includes shadow or canary release, monitoring, fairness/slice checks, rollback, human override, audit logs, and clear success thresholds."),
        ("hard", "computer vision", "A computer-vision model works well in notebooks but fails on real uploaded images. What differences would you investigate?", "A strong answer checks preprocessing, resolution, lighting, compression, camera/source distribution, label definitions, augmentation gaps, and production pipeline parity."),
    ],
    "web_dev": [
        ("easy", "JavaScript", "Explain the JavaScript event loop using a realistic UI example where a promise and a timeout both run.", "A strong answer distinguishes call stack, microtasks, macrotasks, rendering impact, and why promises resolve before timers after synchronous code."),
        ("easy", "REST APIs", "What makes an API endpoint RESTful, and where do teams commonly get REST design wrong?", "A strong answer discusses resources, HTTP methods/status codes, statelessness, idempotency, validation, versioning, and avoids action-heavy endpoint design."),
        ("easy", "authentication", "Explain authentication versus authorization in a web app. Where would you enforce each?", "A strong answer separates identity from permissions and mentions server-side authorization checks, session/token validation, and UI as convenience only."),
        ("medium", "React", "A React screen re-renders slowly when typing in a search box. How would you diagnose and improve it?", "A strong answer uses profiling, state boundaries, memoization carefully, debouncing, virtualization, stable keys, and moving expensive work away from each keystroke."),
        ("medium", "databases", "An API is correct but slow after the dataset grows. What would you inspect before changing application code?", "A strong answer checks query plans, indexes, pagination, N+1 calls, payload size, caching, connection pooling, and realistic load patterns."),
        ("medium", "TypeScript", "How does TypeScript improve reliability in a full-stack app, and what problems does it not solve?", "A strong answer covers type contracts, refactoring safety, API shape validation gaps, runtime data validation, and avoiding false confidence around any/unknown."),
        ("hard", "system design for web", "Design the high-level flow for a multi-tenant dashboard where users must only see their organization's data.", "A strong answer includes tenant scoping in data model, backend authorization, query filters, audit logs, tests, and avoiding client-trusted tenant IDs."),
        ("hard", "performance", "How would you decide between server-side rendering, client-side rendering, and static generation for a product page with personalized content?", "A strong answer weighs SEO, freshness, personalization, caching, latency, complexity, and hybrid approaches such as static shell plus server data."),
        ("hard", "authentication", "How would you implement secure token refresh for a web and mobile client sharing the same backend?", "A strong answer covers short-lived access tokens, refresh rotation, secure storage/cookies, revocation, CSRF/XSS considerations, device logout, and backend validation."),
    ],
    "devops": [
        ("easy", "Docker", "Explain the practical difference between a container and a virtual machine in a deployment conversation.", "A strong answer covers isolation level, startup time, image portability, kernel sharing, resource overhead, and operational tradeoffs."),
        ("easy", "CI/CD pipelines", "What quality gates would you put in a CI pipeline before code reaches production?", "A strong answer includes tests, lint/type checks, security scans, build reproducibility, artifact creation, review checks, and environment-specific deploy approvals."),
        ("easy", "Linux", "A service on Linux is consuming high CPU. What commands or signals would you check first?", "A strong answer mentions top/htop, logs, systemctl status, journalctl, process/thread details, recent changes, and safe mitigation."),
        ("medium", "Kubernetes", "A Kubernetes rollout is stuck. How would you determine whether the issue is image, config, scheduling, or readiness?", "A strong answer checks pod events, describe/logs, image pulls, env/secrets, resource requests, probes, nodes, and deployment status."),
        ("medium", "Terraform", "How do you manage Terraform state safely on a team, and what can go wrong if state is mishandled?", "A strong answer covers remote state, locking, least privilege, drift, secrets, review plans, workspace/environment separation, and recovery."),
        ("medium", "monitoring and alerting", "What is the difference between a noisy alert and an actionable alert? How would you improve alert quality?", "A strong answer ties alerts to user impact/SLOs, clear ownership, runbooks, thresholds, deduplication, severity, and post-incident tuning."),
        ("hard", "CI/CD pipelines", "Design a rollback strategy for a production deployment that passes tests but fails after release.", "A strong answer includes health checks, canaries/blue-green, traffic shifting, database migration safety, observability, rollback triggers, and communication."),
        ("hard", "cloud infrastructure", "How would you plan capacity for a service with predictable daily peaks and occasional campaign spikes?", "A strong answer discusses baselines, autoscaling signals, load testing, queueing/backpressure, cost limits, regional capacity, and graceful degradation."),
        ("hard", "monitoring and alerting", "During an incident, error rate and latency both rise. How would you triage without making the situation worse?", "A strong answer prioritizes user impact, recent changes, dependency health, rollback/mitigation, command discipline, communication, and evidence-based changes."),
    ],
    "data_science": [
        ("easy", "statistics", "Explain correlation versus causation with an example that a business stakeholder would understand.", "A strong answer distinguishes association from causal effect, gives a clear example, and mentions experiments or controls to support causality."),
        ("easy", "data wrangling", "You receive a dataset with missing values, duplicates, and inconsistent categories. What is your first-pass cleaning plan?", "A strong answer profiles data, preserves raw data, handles duplicates/missingness intentionally, standardizes categories, documents assumptions, and validates results."),
        ("easy", "SQL", "When would you use SQL instead of pandas for analysis, and when would pandas be more appropriate?", "A strong answer discusses data size/location, joins/aggregation in database, reproducibility, memory constraints, exploration, and pipeline ownership."),
        ("medium", "experimental design", "Design an A/B test for a product change. What decisions must be made before looking at results?", "A strong answer includes hypothesis, primary metric, sample size, randomization, guardrails, duration, segmentation, and avoiding peeking bias."),
        ("medium", "feature engineering", "How would you detect whether a feature is leaking future information into a predictive model?", "A strong answer checks feature availability time, generation process, suspicious importance, validation splits, business workflow, and temporal testing."),
        ("medium", "data visualization", "How do you choose a visualization for a complex finding when the audience is non-technical?", "A strong answer starts from the decision to support, simplifies axes/labels, shows uncertainty, avoids misleading scales, and pairs chart with narrative."),
        ("hard", "statistics", "A metric improves overall but worsens for an important user segment. How would you investigate and present that finding?", "A strong answer recognizes aggregation effects, checks segment size/significance, business impact, confounders, and communicates tradeoffs transparently."),
        ("hard", "storytelling with data", "Your analysis contradicts a stakeholder's expectation. How would you validate the result and handle the conversation?", "A strong answer rechecks assumptions/data quality, shows evidence, explains limitations, invites critique, and focuses on the decision rather than being right."),
        ("hard", "model evaluation", "A model performs well offline but does not improve the business metric after launch. What explanations would you test?", "A strong answer considers metric mismatch, feedback loops, deployment bugs, user behavior, segment effects, latency, thresholding, and experimental design."),
    ],
    "cloud": [
        ("easy", "cloud service models", "Explain IaaS, PaaS, and serverless using a deployment example rather than definitions only.", "A strong answer explains ownership boundaries, operational burden, scaling model, flexibility, and when each option fits."),
        ("easy", "IAM and security", "What does least privilege mean in cloud IAM, and how would you apply it to a backend service?", "A strong answer grants only required actions/resources, uses roles/service accounts, avoids long-lived keys, audits permissions, and tests access."),
        ("easy", "load balancing", "What problems does a load balancer solve, and what problems does it not solve by itself?", "A strong answer covers traffic distribution, health checks, TLS/routing, and notes it does not fix bad app logic, database bottlenecks, or regional outages alone."),
        ("medium", "networking", "A cloud API is intermittently slow from one region. What network and service signals would you inspect?", "A strong answer checks latency by region, DNS, routing, dependency health, load balancer metrics, logs/traces, retries, and recent changes."),
        ("medium", "storage solutions", "How would you choose between object storage, block storage, and a managed database for an application feature?", "A strong answer considers access pattern, consistency, latency, query needs, durability, cost, backup, and operational complexity."),
        ("medium", "serverless architecture", "What are the tradeoffs of using serverless functions for an event-driven workflow?", "A strong answer covers scaling, operational ease, cold starts, time limits, observability, vendor coupling, local testing, and cost at scale."),
        ("hard", "cloud architecture", "Design a highly available service across multiple availability zones. What failure modes must the design handle?", "A strong answer includes redundancy, health checks, database/storage resilience, stateless services, failover, deployment safety, and monitoring."),
        ("hard", "cost management", "Cloud spend doubles in a week without obvious traffic growth. How would you investigate and control the risk?", "A strong answer checks cost breakdowns, recent deployments, logs/metrics, runaway resources, data transfer, rightsizing, budgets/alerts, and owner accountability."),
        ("hard", "IAM and security", "How would you rotate a production secret without downtime across several services?", "A strong answer supports dual-read/dual-write or staged secret versions, deploy ordering, validation, rollback, audit, and removing old credentials safely."),
    ],
    "mobile_dev": [
        ("easy", "React Native", "Explain what React Native gives you compared with fully native development, and where native knowledge still matters.", "A strong answer covers shared UI/business logic, bridge/native modules, platform APIs, performance, debugging, and release differences."),
        ("easy", "app lifecycle", "What mobile app lifecycle states matter when handling background work or saving user progress?", "A strong answer mentions foreground/background/inactive/terminated behavior, platform limits, persistence, permissions, and user experience."),
        ("easy", "state management", "How would you decide whether state belongs locally in a component, globally in a store, or on the server?", "A strong answer considers ownership, sharing, persistence, cache invalidation, server truth, complexity, and testability."),
        ("medium", "performance optimization", "A long list screen feels slow on mid-range Android devices. How would you diagnose and improve it?", "A strong answer uses profiling, virtualization, stable rendering, image optimization, memoization carefully, pagination, and avoiding expensive work on render."),
        ("medium", "push notifications", "Explain the end-to-end flow for push notifications in a React Native app.", "A strong answer covers permission, device token registration, backend storage, provider delivery, payload design, tap handling, and failure/refresh cases."),
        ("medium", "offline functionality", "How would you design a mobile feature that lets users continue working while offline?", "A strong answer covers local persistence, queued writes, sync status, conflict handling, retries, user feedback, and idempotent backend APIs."),
        ("hard", "authentication", "How would you store and refresh auth tokens securely on mobile while keeping the session reliable?", "A strong answer mentions secure storage/keychain, short-lived tokens, refresh flow, logout/revocation, race handling, and avoiding logs or plain storage."),
        ("hard", "app store deployment", "A release works in development but crashes for production users after rollout. How would you triage and respond?", "A strong answer covers crash analytics, staged rollout, rollback/hotfix options, symbolication, feature flags, reproduction, and user communication."),
        ("hard", "mobile UX principles", "How would you handle a cross-platform feature that behaves differently on iOS and Android without creating an inconsistent product?", "A strong answer balances platform conventions with product consistency, isolates native differences, tests both platforms, documents behavior, and measures user impact."),
    ],
}


CODING_LOGIC_QUESTIONS_BY_TRACK: dict[str, list[tuple[str, str, str]]] = {
    "ml_ai": [
        ("medium", "Handwrite pseudocode to maintain the top-k most frequent labels from a stream of predictions. Include the data structures, update logic, and time/space complexity.", "A strong solution uses a frequency map plus heap or sorted structure, handles ties and updates, and explains complexity clearly."),
        ("medium", "Handwrite the logic for creating stratified train/validation/test splits from labeled data. Include how you handle rare classes and reproducibility.", "A strong solution groups by label, shuffles deterministically, allocates ratios per class, handles tiny classes explicitly, and avoids leakage."),
        ("hard", "Handwrite pseudocode to compute precision, recall, and F1 per class from a confusion matrix, then flag classes needing review.", "A strong solution iterates classes, handles zero denominators, computes metrics correctly, and identifies low-performing classes with thresholds."),
        ("hard", "Handwrite an algorithm to detect feature drift by comparing current numeric feature distributions with a baseline summary.", "A strong solution computes robust statistics or bucketed distributions, compares against thresholds, handles missing values, and reports affected features."),
    ],
    "web_dev": [
        ("medium", "Handwrite pseudocode for rate limiting login attempts by both user ID and IP address. Include expiry, reset behavior, and the returned decision.", "A strong solution keys attempts by user/IP, uses time windows or token buckets, expires old entries, and avoids locking out users indefinitely."),
        ("medium", "Handwrite logic for merging paginated API results while preserving order and removing duplicate records by ID.", "A strong solution tracks seen IDs, appends first occurrence in order, handles empty pages, and avoids O(n²) duplicate checks."),
        ("hard", "Handwrite pseudocode for debounced search that cancels stale requests and ignores out-of-order responses.", "A strong solution debounces input, uses request IDs or abort controllers, cancels prior work, handles loading/error states, and applies only the latest response."),
        ("hard", "Handwrite an algorithm to normalize nested API response data into entity maps and ordered ID lists for a frontend cache.", "A strong solution recursively extracts entities, preserves relationships, handles duplicates, and keeps normalized maps consistent."),
    ],
    "devops": [
        ("medium", "Handwrite pseudocode to detect a flapping service from recent health-check results. Include thresholds and what alert state should be emitted.", "A strong solution uses a sliding window, counts state transitions/failures, applies thresholds, and avoids noisy alerts with cooldowns."),
        ("medium", "Handwrite a rollback decision flow for a failed production deployment. Include health checks, traffic switching, and communication triggers.", "A strong solution checks objective failure signals, pauses rollout, shifts traffic or reverts safely, validates recovery, and notifies owners."),
        ("hard", "Handwrite pseudocode to identify the top failing services from structured logs grouped by service and error type.", "A strong solution parses bounded input, groups counts efficiently, sorts or heaps top results, and handles missing/unknown service names."),
        ("hard", "Handwrite a deployment health monitor that uses exponential backoff retries before marking a release unhealthy.", "A strong solution retries with capped backoff, distinguishes transient from persistent failures, records attempts, and emits a clear final state."),
    ],
    "data_science": [
        ("medium", "Handwrite pseudocode to detect and cap outliers in a numeric column using the IQR method. Include null handling.", "A strong solution computes quartiles on non-null data, calculates fences, caps values, preserves nulls, and documents changed rows."),
        ("medium", "Handwrite logic to compute grouped summary statistics by category while handling missing numeric values.", "A strong solution groups rows, ignores or counts nulls intentionally, computes count/mean/min/max safely, and returns stable output."),
        ("hard", "Handwrite pseudocode to compute precision, recall, and F1 from true labels and predicted labels without using libraries.", "A strong solution builds TP/FP/FN counts, handles zero denominators, computes metrics correctly, and explains complexity."),
        ("hard", "Handwrite an algorithm to sample a fixed-size representative subset from a large data stream.", "A strong solution uses reservoir sampling or stratified counters, explains randomness, memory bounds, and limitations for representativeness."),
    ],
    "cloud": [
        ("medium", "Handwrite a request-routing decision flow across healthy instances in multiple availability zones.", "A strong solution checks health and capacity, prefers local healthy targets, fails over across zones, and avoids sending traffic to unhealthy instances."),
        ("medium", "Handwrite pseudocode for rotating an application secret without downtime across multiple running services.", "A strong solution supports overlapping old/new secrets, staged rollout, validation, rollback, and final revocation."),
        ("hard", "Handwrite a circuit-breaker algorithm for calls to a failing cloud dependency. Include closed, open, and half-open states.", "A strong solution tracks failures over time, opens after threshold, probes recovery safely, resets on success, and limits cascading failure."),
        ("hard", "Handwrite pseudocode to detect a cloud cost anomaly from daily service-level spend data.", "A strong solution computes baselines, compares percentage/absolute thresholds, groups by service, handles missing days, and emits actionable anomalies."),
    ],
    "mobile_dev": [
        ("medium", "Handwrite pseudocode for an offline-first sync queue that retries failed writes safely after connectivity returns.", "A strong solution persists queued operations, marks idempotency keys, retries with backoff, preserves order where needed, and reports sync state."),
        ("medium", "Handwrite logic to resolve conflicts when local edited data and server data changed while the device was offline.", "A strong solution compares versions/timestamps, detects conflicts, applies safe merges, asks the user when necessary, and avoids silent data loss."),
        ("hard", "Handwrite pseudocode for resumable image upload on mobile with retry, progress, and cancellation support.", "A strong solution chunks or resumes uploads, tracks progress, handles network errors with retry/backoff, supports cancellation, and cleans temporary state."),
        ("hard", "Handwrite an LRU cache for recently viewed mobile screens or API responses. Include get, put, eviction, and capacity behavior.", "A strong solution combines a hash map with an ordered list, updates recency on access, evicts least-recently-used items, and explains O(1) operations."),
    ],
}


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:48]


def _document(
    *,
    key: str,
    track_id: str,
    phase: str,
    question_text: str,
    answer_type: str,
    difficulty: str,
    scoring_criteria: list[str],
    model_answer: str,
    tags: list[str],
) -> dict[str, Any]:
    return {
        "question_key": key,
        "bank_version": PROFESSIONAL_BANK_VERSION,
        "source": "seed_professional_bank",
        "is_active": True,
        "track_id": track_id,
        "phase": phase,
        "question_text": question_text,
        "answer_type": answer_type,
        "difficulty": difficulty,
        "scoring_criteria": scoring_criteria,
        "model_answer": model_answer,
        "tags": sorted(set([*tags, phase, difficulty, PROFESSIONAL_BANK_VERSION])),
    }


def _build_documents() -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []

    for index, question in enumerate(HR_QUESTIONS, start=1):
        documents.append(
            _document(
                key=f"{PROFESSIONAL_BANK_VERSION}:hr:all:{index:02d}",
                track_id="all",
                phase="hr",
                question_text=question["question_text"],
                answer_type="voice",
                difficulty=question["difficulty"],
                scoring_criteria=HR_SCORING_CRITERIA,
                model_answer=question["model_answer"],
                tags=question["tags"],
            )
        )

    for index, question in enumerate(BEHAVIORAL_QUESTIONS, start=1):
        documents.append(
            _document(
                key=f"{PROFESSIONAL_BANK_VERSION}:behavioral:all:{index:02d}",
                track_id="all",
                phase="behavioral",
                question_text=question["question_text"],
                answer_type="voice",
                difficulty=question["difficulty"],
                scoring_criteria=BEHAVIORAL_SCORING_CRITERIA,
                model_answer=question["model_answer"],
                tags=question["tags"],
            )
        )

    for track_id, questions in TECHNICAL_QUESTIONS_BY_TRACK.items():
        for index, (difficulty, topic, question_text, model_answer) in enumerate(questions, start=1):
            documents.append(
                _document(
                    key=f"{PROFESSIONAL_BANK_VERSION}:technical:{track_id}:{index:02d}",
                    track_id=track_id,
                    phase="technical",
                    question_text=question_text,
                    answer_type="text",
                    difficulty=difficulty,
                    scoring_criteria=TECHNICAL_SCORING_CRITERIA,
                    model_answer=model_answer,
                    tags=["technical", track_id, _slug(topic)],
                )
            )

    for track_id, questions in CODING_LOGIC_QUESTIONS_BY_TRACK.items():
        for index, (difficulty, question_text, model_answer) in enumerate(questions, start=1):
            documents.append(
                _document(
                    key=f"{PROFESSIONAL_BANK_VERSION}:coding_logic:{track_id}:{index:02d}",
                    track_id=track_id,
                    phase="coding_logic",
                    question_text=question_text,
                    answer_type="image",
                    difficulty=difficulty,
                    scoring_criteria=CODING_LOGIC_SCORING_CRITERIA,
                    model_answer=model_answer,
                    tags=["coding-logic", "handwritten", track_id],
                )
            )

    return documents


def main() -> None:
    mongodb_url = os.environ["MONGODB_URL"]
    db_name = os.environ.get("MONGODB_DB_NAME", "vprep")

    now = datetime.now(timezone.utc)
    client = MongoClient(mongodb_url)
    try:
        db = client[db_name]
        collection = db["questions"]
        collection.create_index("question_key", unique=True, sparse=True)
        collection.create_index([("phase", 1), ("track_id", 1), ("difficulty", 1), ("bank_version", 1)])

        inserted = 0
        updated = 0
        for document in _build_documents():
            result = collection.update_one(
                {"question_key": document["question_key"]},
                {
                    "$set": {**document, "updated_at": now},
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )
            if result.upserted_id is not None:
                inserted += 1
            else:
                updated += result.modified_count

        print(
            f"Professional question bank {PROFESSIONAL_BANK_VERSION}: "
            f"{inserted} inserted, {updated} updated in '{db_name}.questions'."
        )
    finally:
        client.close()


if __name__ == "__main__":
    main()
