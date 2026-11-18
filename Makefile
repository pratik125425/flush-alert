PY ?= .venv/bin/python

.PHONY: all data analysis figures export site test clean-results

all: test analysis figures export site

data:            ## download from the USGS Water Data APIs into data/raw/ (cached; skips what exists)
	$(PY) -u -m src.fetch

analysis:        ## prep, backtest, load errors, adaptive sampling, flow-only map (cached data only)
	$(PY) -m src.analysis
	$(PY) -m src.flow_only_map

figures:
	$(PY) -m src.figures

export:          ## JSON for the site -> site/public/data/
	$(PY) -m src.export

site: export
	cd site && npm ci --no-audit --no-fund && npm run build

test:
	$(PY) -m pytest -q tests
