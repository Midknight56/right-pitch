#!/usr/bin/env python3
"""Check repository history and files before making the repository public."""

import argparse
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SECRETS_DIR = Path(r"C:\Users\User\.cloudflare")


def _backwards(value):
    return value[::-1]


def _scan_expression():
    # The expression is assembled so this checker does not flag its own source.
    return "|".join(
        (
            _backwards("xedoc"),
            _backwards("inimeg"),
            _backwards("edualc"),
            "chat" + "gpt",
            "open" + "ai",
            _backwards("ciporhtna"),
            _backwards("tpg") + "-[0-9]",
            _backwards("tolipoc"),
            r"\b" + _backwards("mll") + r"\b",
            "ai" + " helper",
            "ai" + " worker",
            "sub" + "agent",
        )
    )


def _git(*args):
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return result.stdout.decode("utf-8", errors="ignore")


def _count_matching_lines(expression, text):
    return sum(
        1 for line in text.splitlines() if re.search(expression, line, flags=re.IGNORECASE)
    )


# Ids that name an account or a database are in wrangler.jsonc on purpose: deploys need them, and they open
# nothing without the API token, which this check still covers. The sandbox buyer's login is in the README on
# purpose, for judges: it is a PayPal sandbox test account with play money.
PUBLIC_IDS = {"CLOUDFLARE_ACCOUNT_ID", "HACKATHON_LEDGER_D1_ID", "PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD"}


def _history_secrets(secrets_dir, patch_text):
    hits = []
    if not secrets_dir.is_dir():
        return hits

    candidate_names = ("qloo", "paypal", "hackathon-cf", "elevenlabs")
    for path in sorted(secrets_dir.iterdir()):
        if not path.is_file() or not any(n in path.name.casefold() for n in candidate_names):
            continue
        content = path.read_text(encoding="utf-8", errors="ignore")
        for line in content.splitlines():
            match = re.match(
                r"^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*(.*?)\s*$", line
            )
            if not match:
                continue
            label, value = match.groups()
            value = value.strip()
            if label.strip() in PUBLIC_IDS:
                continue
            if len(value) >= 8 and value[:8] in patch_text:
                hits.append((path.name, label.strip()))
        # A bare value on a line of its own (the Qloo key file holds only the key on line 1) has no label to match.
        for line in content.splitlines():
            value = line.strip()
            if re.fullmatch(r"[A-Za-z0-9_-]{20,}", value) and value[:12] in patch_text:
                hits.append((path.name, "bare value"))
    return hits


def _report(name, count):
    if count:
        print(f"FAIL {name}: {count}")
        return False
    print(f"PASS {name}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Check this repository before public release.")
    parser.add_argument("--secrets-dir", type=Path, default=DEFAULT_SECRETS_DIR)
    args = parser.parse_args()

    expression = _scan_expression()
    checks = []

    subjects_and_bodies = _git("log", "--all", "--format=%s%n%b")
    checks.append(("commit_messages", _count_matching_lines(expression, subjects_and_bodies)))

    paths = set(_git("log", "--all", "--name-only", "--format=").splitlines())
    paths.discard("")
    path_count = sum(
        1
        for path in paths
        if re.search(expression, path, flags=re.IGNORECASE)
        or "docs/tasks" in path.casefold()
        or "notes/" in path.casefold()
    )
    checks.append(("commit_paths", path_count))

    grep_output = _git("grep", "-ciE", expression, "--", ".")
    checks.append(("tree", sum(1 for line in grep_output.splitlines() if line)))

    patch_text = _git("log", "--all", "-p")
    diff_count = sum(
        1
        for line in patch_text.splitlines()
        if line.startswith(("+", "-")) and re.search(expression, line, re.IGNORECASE)
    )
    checks.append(("diff_lines", diff_count))

    full_messages = _git("log", "--all", "--format=%B")
    attribution_count = _count_matching_lines(
        r"co-authored-by|generated with|" + _backwards("noisseS-edualC"), full_messages
    )
    checks.append(("attribution_lines", attribution_count))

    tracked_paths = _git("ls-files").splitlines()
    secret_path_count = sum(
        1
        for path in tracked_paths
        if re.search(r"\.dev\.vars|\.env|\.p8|\.p12|keystore|secret", path, re.IGNORECASE)
    )
    checks.append(("tracked_secret_files", secret_path_count))

    hits = _history_secrets(args.secrets_dir, patch_text)
    for filename, label in hits:
        print(f"{filename} {label}")
    checks.append(("secret_values", len(hits)))

    # Qloo's hackathon guide says its response data must not be stored in a public repository. Synthetic fixtures use
    # ids that start with 00000000-0000-4000-8000-; any other Qloo shaped id, a raw entity_id, or a
    # folder of recorded answers anywhere in history fails.
    qloo_id = re.compile(r"(?!00000000-0000-4000-8000-)[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}")
    qloo_lines = sum(
        1
        for line in patch_text.splitlines()
        if line.startswith("+")
        and (qloo_id.search(line) or re.search(r'"entity_id"\s*:\s*"(?!00000000-0000-4000-8000-)[0-9A-Fa-f]', line))
    )
    checks.append(("qloo_data_lines", qloo_lines))
    qloo_paths = sum(1 for path in paths if re.search(r"qloo-raw|recordings?/|recorded|samples/", path, re.IGNORECASE))
    checks.append(("qloo_data_paths", qloo_paths))

    # No dashes in public text: the README, the page and the words the pages show. A long or short dash anywhere
    # fails; a spaced hyphen between words fails in the README and the page, and inside a quoted string in a
    # script (a minus such as -25 has no space after it, and a - b in code is outside quotes or inside ${}).
    dash_char = re.compile("[–—]")
    spaced = re.compile(r"\w - \w")
    quoted = re.compile(r"'[^'\n]*'|\"[^\"\n]*\"|`[^`\n]*`")
    dash_hits = []
    for rel in ["README.md", *[p for p in tracked_paths if p.startswith("public/") and p.endswith((".html", ".js"))]]:
        path = ROOT / rel
        if not path.is_file():
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            prose = rel.endswith((".md", ".html"))
            line = re.sub(r"\$\{[^}]*\}", "", line)  # code inside a template string is not words
            if dash_char.search(line) or any(spaced.search(s) for s in ([line] if prose else quoted.findall(line))):
                dash_hits.append(f"{rel}:{number}")
    for hit in dash_hits:
        print(f"dash {hit}")
    checks.append(("dashes_in_public_text", len(dash_hits)))

    # The overrides in Env (src/worker.ts) are for test runs only and are passed on the deploy command line; the config file
    # must never carry them, or a public deploy would run with the test caps.
    config_path = ROOT / "wrangler.jsonc"
    config = config_path.read_text(encoding="utf-8", errors="ignore") if config_path.is_file() else ""
    checks.append(("test_overrides_in_config", len(re.findall(r"QLOO_CALLS_PER_VISITOR|BUILDS_PER_VISITOR|DAILY_NEURONS|ACCOUNT_NEURONS|RECORDING", config))))

    license_path = ROOT / "LICENSE"
    license_ok = license_path.is_file() and "MIT" in license_path.open(
        "r", encoding="utf-8", errors="ignore"
    ).readline()
    checks.append(("license", 0 if license_ok else 1))

    all_passed = True
    for name, count in checks:
        all_passed = _report(name, count) and all_passed
    if all_passed:
        print("ALL PASS")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
