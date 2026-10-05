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


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/predict", dependencies=[Depends(auth)])
def predict(req: Req):
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
