import numpy as np

from propensity.recommendation import get_member_recommendation, rank_categories
from propensity.data import CATEGORY_NAMES


def test_rank_categories_ordering():
    scores = np.array([0.1, 0.9, 0.2])
    cats = ["A", "B", "C"]
    ranked = rank_categories(scores, cats)
    assert ranked[0][0] == "B"
    assert ranked[-1][0] == "A"


def test_get_member_recommendation_with_explicit_index():
    mat = np.array(
        [
            [0.1] * 10,
            [0.0, 0.5, 0.2, 0.1, 0.0, 0.3, 0.0, 0.4, 0.2, 0.1],
        ]
    )
    res = get_member_recommendation("member-x", data=mat, member_index=1, top_k=2)
    recs = [c for c, _ in res["recommendations"]]
    assert recs == [CATEGORY_NAMES[1], CATEGORY_NAMES[7]]  # Health, Food&Beverage


def test_threshold_filtering_and_fallback():
    mat = np.array([[0.1] + [0.0] * 9])
    res = get_member_recommendation("m", data=mat, member_index=0, top_k=3, min_threshold=0.2)
    # threshold removes all, fallback to top_k from ranked list
    assert len(res["recommendations"]) == 3
