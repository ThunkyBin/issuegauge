import json

import pytest


CONTRACT = "contracts/issue_gauge.py"
GOOD_URL = "https://github.com/example/project/issues/42"


def _good_assessment(note="Add the exact version and a minimal reproduction."):
    return json.dumps(
        {
            "evidence_sufficient": True,
            "issue_kind": "BUG",
            "problem_clear": True,
            "steps_or_acceptance": True,
            "context_present": True,
            "supporting_evidence": True,
            "note": note,
        }
    )


def test_empty_state(direct_deploy):
    contract = direct_deploy(CONTRACT)
    assert int(contract.get_review_count()) == 0
    assert contract.get_review(0) == ""


@pytest.mark.parametrize("url", ["", "   ", "x" * 2049])
def test_rejects_empty_or_oversized_url(direct_vm, direct_deploy, url):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert("Provide one public GitHub issue URL"):
        contract.review_issue(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/example/project/issues/42",
        "https://user:pass@github.com/example/project/issues/42",
        "https://github.com:443/example/project/issues/42",
        "https://github.com.evil.example/example/project/issues/42",
        "https://example.com/example/project/issues/42",
        "https://github.com/example/project/pull/42",
        "https://github.com/example/project/issues/0",
        "https://github.com/example/project/issues/042",
        "https://github.com/example/project/issues/42?tab=comments",
        "https://github.com/example/project/issues/42#issuecomment-1",
        "https://github.com/example/project/issues/42/extra",
        "https://github.com/example..repo/project/issues/42",
        "https://github.com/example/project/issues/not-a-number",
    ],
)
def test_rejects_noncanonical_or_nonissue_urls(direct_vm, direct_deploy, url):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert("Use a public URL in the form"):
        contract.review_issue(url)


def test_canonicalizes_url_and_stores_consensus_result(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.mock_web(
        r"github\.com/Example/Project/issues/42",
        {"status": 200, "body": "Bug report: steps, expected result, actual result, GenLayer Studio 0.1."},
    )
    direct_vm.mock_llm(r".*", _good_assessment())

    review_id = contract.review_issue("https://github.com/Example/Project/issues/42/")
    record = json.loads(contract.get_review(review_id))

    assert int(review_id) == 0
    assert int(contract.get_review_count()) == 1
    assert record["issue_url"] == "https://github.com/Example/Project/issues/42"
    assert record["status"] == "READY"
    assert record["issue_kind"] == "BUG"
    assert record["readiness_score"] == 80
    assert record["problem_clear"] is True
    assert record["steps_or_acceptance"] is True
    assert record["context_present"] is True
    assert record["supporting_evidence"] is True
    assert record["note"] == "All four checklist items were visible; a maintainer still decides what to do next."
    assert record["consensus_rule"] == "independent_agreement_on_issue_type_and_four_checklist_fields"
    assert record["issue_text_stored"] is False


def test_needs_detail_when_a_checklist_item_is_missing(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.mock_web(r"github\.com/example/project/issues/42", {"status": 200, "body": "An issue description."})
    direct_vm.mock_llm(
        r".*",
        json.dumps(
            {
                "evidence_sufficient": True,
                "issue_kind": "BUG",
                "problem_clear": True,
                "steps_or_acceptance": False,
                "context_present": True,
                "supporting_evidence": False,
                "note": "Please add ordered reproduction steps.",
            }
        ),
    )

    review_id = contract.review_issue(GOOD_URL)
    record = json.loads(contract.get_review(review_id))
    assert record["status"] == "NEEDS_DETAIL"
    assert record["readiness_score"] == 40
    assert "add reproduction steps" in record["note"]


def test_fetch_failure_records_unclear(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.mock_web(r"github\.com/example/project/issues/42", {"status": 503, "body": "unavailable"})

    review_id = contract.review_issue(GOOD_URL)
    record = json.loads(contract.get_review(review_id))
    assert record["status"] == "UNCLEAR"
    assert record["issue_kind"] == "UNCLEAR"
    assert record["evidence_sufficient"] is False
    assert record["readiness_score"] == 0


def test_incomplete_model_output_records_unclear(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.mock_web(r"github\.com/example/project/issues/42", {"status": 200, "body": "Public issue text."})
    direct_vm.mock_llm(r".*", json.dumps({"issue_kind": "BUG", "problem_clear": True}))

    review_id = contract.review_issue(GOOD_URL)
    record = json.loads(contract.get_review(review_id))
    assert record["status"] == "UNCLEAR"
    assert record["evidence_sufficient"] is False


def test_consensus_rejects_changed_checklist_field(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.mock_web(r"github\.com/example/project/issues/42", {"status": 200, "body": "Public issue text."})
    direct_vm.mock_llm(r".*", _good_assessment())
    contract.review_issue(GOOD_URL)

    direct_vm.clear_mocks()
    direct_vm.mock_web(r"github\.com/example/project/issues/42", {"status": 200, "body": "Public issue text."})
    direct_vm.mock_llm(
        r".*",
        json.dumps(
            {
                "evidence_sufficient": True,
                "issue_kind": "BUG",
                "problem_clear": True,
                "steps_or_acceptance": False,
                "context_present": True,
                "supporting_evidence": True,
                "note": "Steps are absent.",
            }
        ),
    )

    assert direct_vm.run_validator() is False


def test_consensus_allows_different_note_when_rubric_matches(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.mock_web(r"github\.com/example/project/issues/42", {"status": 200, "body": "Public issue text."})
    direct_vm.mock_llm(r".*", _good_assessment("Leader wording."))
    contract.review_issue(GOOD_URL)

    direct_vm.clear_mocks()
    direct_vm.mock_web(r"github\.com/example/project/issues/42", {"status": 200, "body": "Other page phrasing."})
    direct_vm.mock_llm(r".*", _good_assessment("Validator wording."))

    assert direct_vm.run_validator() is True
