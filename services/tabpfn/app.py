"""Sahaay TabPFN service.

Generic pooled tabular regression with quantiles. The Next.js app builds past-only
feature rows (see src/lib/forecast-core.ts: featureRow/buildTrainingRows) and posts them here.
TabPFN is an in-context learner: `fit` stores the training set, `predict` does the inference.

POST /predict
  { "train": {"X": [[...]], "y": [...]},
    "predict": {"X": [[...]]},
    "quantiles": [0.1, 0.5, 0.9] }
-> { "mean": [...], "q10": [...], "q50": [...], "q90": [...] }
"""
import os
from typing import List, Optional

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from tabpfn import TabPFNRegressor

app = FastAPI(title="Sahaay TabPFN")
API_KEY = os.getenv("TABPFN_API_KEY")


class Block(BaseModel):
    X: List[List[float]]
    y: Optional[List[float]] = None


class Req(BaseModel):
    train: Block
    predict: Block
    quantiles: List[float] = [0.1, 0.5, 0.9]


def auth(authorization: Optional[str] = Header(default=None)):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="unauthorized")


def _tabpfn_version() -> tuple[int, str]:
    from importlib.metadata import version

    raw = version("tabpfn")
    try:
        return int(raw.split(".")[0]), raw
    except ValueError:  # unparseable version string: treat as unverified, not as safe
        return 999, raw


# Only the v2 weights carry a license that permits commercial use ("Prior Labs License v1.1",
# Apache-2.0 + attribution). Later releases - what a bare `pip install tabpfn` resolves to now -
# are non-commercial and explicitly bar using results for commercial decision-making, which is
# precisely what Sahaay does with a forecast. The version check is enforced, not documented.
COMMERCIAL_OK_MAJOR = 2
ATTRIBUTION = "Includes TabPFN v2 weights (Prior Labs), licensed under the Prior Labs License v1.1 (Apache-2.0 with attribution)."


@app.get("/health")
def health():
    major, raw = _tabpfn_version()
    if major > COMMERCIAL_OK_MAJOR:
        raise HTTPException(status_code=503, detail=f"tabpfn {raw} weights are non-commercially licensed; pin tabpfn>=2.0,<3")
    return {"ok": True, "tabpfnVersion": raw, "license": "priorlabs-1.1", "attribution": ATTRIBUTION}


@app.post("/predict", dependencies=[Depends(auth)])
def predict(req: Req):
    major, raw = _tabpfn_version()
    if major > COMMERCIAL_OK_MAJOR:
        raise HTTPException(status_code=503, detail=f"refusing to forecast with tabpfn {raw}: its license bars commercial decision support")
    if not req.train.y or len(req.train.X) != len(req.train.y):
        raise HTTPException(status_code=422, detail="train.X and train.y must have equal length")
    if len(req.train.X) < 20:
        raise HTTPException(status_code=422, detail="need at least 20 training rows")
    X = np.asarray(req.train.X, dtype=float)
    y = np.asarray(req.train.y, dtype=float)
    Xp = np.asarray(req.predict.X, dtype=float)

    # CPU is fine for the few-hundred-row tables Sahaay builds; set TABPFN_DEVICE=cuda if available.
    model = TabPFNRegressor(device=os.getenv("TABPFN_DEVICE", "auto"))
    model.fit(X, y)
    mean = model.predict(Xp)
    qs = sorted(set(req.quantiles + [0.1, 0.9]))
    quantile_preds = model.predict(Xp, output_type="quantiles", quantiles=qs)
    by_q = {q: np.asarray(p) for q, p in zip(qs, quantile_preds)}
    return {
        "mean": np.maximum(mean, 0).tolist(),
        "q10": np.maximum(by_q[0.1], 0).tolist(),
        "q50": np.maximum(by_q.get(0.5, mean), 0).tolist(),
        "q90": np.maximum(by_q[0.9], 0).tolist(),
    }
