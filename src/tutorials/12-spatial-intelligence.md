---
title: Spatial Intelligence - Mapping Apartment Listings by Meaning
date: "2026-03-28"
author: Adam Vosburgh
sequence: 12
cat: tutorial
published: false
---

This tutorial is about using language models to work with text as spatial data. We will take a dataset of StreetEasy apartment listings in Manhattan, and use two different techniques to turn the *language* in those listing descriptions into something we can map.

The tutorial has two parts, both working from the same CSV of listings:

In **Part 1**, we use a language model to classify each listing description: does it primarily sell the *neighborhood* (location, transit, nearby amenities) or the *unit itself* (finishes, layout, appliances)? We aggregate those labels by census neighborhood and map the result as a choropleth.

In **Part 2**, we pass each description through an embedding model to get a high-dimensional vector that encodes its meaning. We then reduce those vectors down to 2D with UMAP, cluster them with k-means, auto-label each cluster, and map the results both geographically and semantically.

A companion scraping tutorial explains how the dataset was collected.

## What are embeddings?

Before we get into the code, it's worth understanding what an embedding actually is, since it's the core concept behind Part 2.

When a language model is trained on billions of texts, it learns to represent every word — and eventually every sentence or paragraph — as a list of numbers called a **vector** (or **embedding**). These numbers are not arbitrary: they are learned so that words and phrases with similar meanings end up with similar numbers. "Steps from the park" and "across from the park entrance" will have nearly identical vectors despite sharing no words, because the model learned that both describe the same spatial relationship.

In this tutorial, we use that property at the scale of whole listing descriptions. Each description gets compressed into a single vector (768 numbers long, for the model we're using). That vector is a coordinate in a 768-dimensional space — a space where closeness means similarity of meaning.

The same idea shows up in several other contexts you've encountered in this course. **AlphaEarth** (Google) does this for satellite imagery: every 10-meter pixel gets a vector encoding what the surface looks like, and the result is a continuous semantic space of land cover — farmland clusters near farmland, water near water, regardless of geography. The targeting systems we discussed in lecture (Lavender and similar military AI systems) convert people, places, and behaviors into vectors, and "similarity to a target profile" is literally a distance calculation in that space. And when you type a message to Claude or ChatGPT, every token is immediately converted into an embedding vector before any processing happens — the model operates entirely in this numerical space.

Embeddings are not metaphorical coordinates — they are the actual computational substrate of how these models work. That's what makes this tutorial interesting from a spatial research perspective.

## Setup

This notebook uses two different kinds of language models, and it's important to keep the distinction in mind:

**Part 1** uses a **generation model** — a model trained to produce text. We use it as a classifier by prompting it to read each listing and output a label. The default is `qwen2.5:3b` via Ollama.

**Part 2** uses an **embedding model** — a model trained to produce vectors that encode meaning. The default is `nomic-embed-text` via Ollama.

These are fundamentally different tasks: generation models produce text, embedding models produce vectors. You cannot use one in place of the other.

There are two ways to run the models. The default is **local mode** using [Ollama](https://ollama.ai), which runs the models on your own machine. If your computer can't handle that, there's also a **HuggingFace API mode** that runs models in the cloud (you'll need a free HF account and token). The code includes both options — the HF version is commented out but ready to go.

If you're going with Ollama (recommended), install it from [ollama.ai](https://ollama.ai), then pull the two models you'll need:

```
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
```

Before running the notebook, install the python dependencies: `pip install -r requirements.txt`

### Imports

Let's start by importing everything we'll need. Copy this into the first cell of your notebook and run it.

```python
# Standard library
import os
import json
import time

# Data manipulation
import pandas as pd
import numpy as np

# Language model — local (Ollama) or cloud (HuggingFace API)
import ollama

# Machine learning — used in Part 2
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize   # L2-normalizes vectors before clustering
from scipy.spatial.distance import cosine as cosine_distance
import umap

# Visualization — Altair for all maps and charts in both parts
import altair as alt
import plotly.express as px
alt.data_transformers.disable_max_rows()  # lift Altair's default 5000-row limit

# Geospatial — used in Part 1 for the NTA spatial join
import geopandas as gpd

# HuggingFace API mode (commented out — only needed if not using Ollama)
from huggingface_hub import InferenceClient

print("Imports OK.")
```

If you get an import error for any of these, check that you ran `pip install -r requirements.txt`.

### Load the dataset

Next, load the StreetEasy listings CSV and take a look at what we're working with.

```python
# Load the dataset
df = pd.read_csv('data/streeteasy_full.csv')

print(f"Dataset shape: {df.shape}")
print(f"Columns: {list(df.columns)}")
print()

# Preview the first few rows
display(df.head(3))

# Print one full description so we can see what the raw text actually looks like.
# These descriptions are messy and variable — that's fine, the model handles it.
print("\n--- Example listing description ---")
print(df['description'].iloc[0])
```

Take a look at the description that prints. These are real listing descriptions scraped from StreetEasy — they're messy, inconsistent, sometimes full of all-caps or weird formatting. That's fine. One of the useful things about working with language models is that they handle this kind of variation without any cleaning on our part.

## Part 1: Classification with Prompting

In this part we use a generation model to classify each listing description along one dimension: does this listing primarily sell the *neighborhood* (transit, parks, character) or the *unit itself* (layout, finishes, light)?

We label each description **1** (neighborhood-forward) or **0** (unit-forward) using zero-shot prompting — no examples, no labeled training data, just a clear prompt. We then aggregate the results to the NTA (Neighborhood Tabulation Area) level and map the average score as a choropleth.

This is one of the most direct uses of language models in spatial analysis: the model acts as a fast, scalable reader that converts unstructured text into a structured signal you can map.

### Step 1.1: Define the generation model

The first thing we need to do is set up the generation model and make sure Ollama is running. We use `qwen2.5:3b` by default — it's small, fast, and good enough for a simple binary classification like this. If you want to try a different model, just change `GENERATION_MODEL` below to anything you've pulled via `ollama pull`.

```python
# ── Generation model setup ────────────────────────────────────────────────────
# Change this to switch models. Options:
#   'qwen2.5:3b'  — fast, good enough for binary classification
#   'qwen2.5:7b'  — more accurate, needs more RAM, slower
GENERATION_MODEL = 'qwen2.5:3b'

# Quick connectivity check — makes sure Ollama is running before the long loop.
try:
    _test = ollama.chat(
        model=GENERATION_MODEL,
        messages=[{'role': 'user', 'content': 'Reply with the word OK and nothing else.'}]
    )
    print(f"Ollama OK — model: {GENERATION_MODEL}")
    print(f"Test response: {_test['message']['content'].strip()}")
except Exception as e:
    print(f"Could not reach Ollama: {e}")
    print("Make sure Ollama is running:")
    print(f"  ollama pull {GENERATION_MODEL}")
    print("  ollama serve   (if not already running as a background service)")
```

If this prints "Ollama OK" you're good. If not, make sure Ollama is actually running — on Mac it should be visible in the menu bar, on other systems you may need to run `ollama serve` in a separate terminal.

### Step 1.2: Classify each listing

Now we'll loop over every listing description and ask the model to classify it. The function below builds a prompt that describes the two categories and asks the model to reply with a single digit — 1 for neighborhood-forward, 0 for unit-forward.

A few things to pay attention to as this runs. The prompt is deliberately constrained ("Reply with ONLY the digit 1 or 0") to simplify parsing — small models sometimes ignore this, so we mark those as `-1` and exclude them later. Try reading a few descriptions yourself before looking at the model's label. Do you agree? Where does it surprise you? Keep in mind this is a binary classification, and real listings are often mixed — the model is forced to pick a dominant orientation.

**This step takes 5–10 minutes for ~250 listings.** 

```python
def classify_listing(description, model=GENERATION_MODEL):
    """
    Ask the LLM to classify a listing description.
    Returns 1 (neighborhood-forward), 0 (unit-forward), or -1 (parse failure).
    """
    prompt = (
        "You are classifying apartment rental listings.\n"
        "Read the listing description below and decide which it primarily emphasizes:\n\n"
        "  1 = NEIGHBORHOOD-FORWARD: mainly sells the location — "
        "transit, nearby parks, restaurants, walkability, neighborhood character.\n"
        "  0 = UNIT-FORWARD: mainly describes the apartment itself — "
        "finishes, layout, appliances, light, renovations.\n\n"
        "Reply with ONLY the digit 1 or 0. No explanation.\n\n"
        f"Listing:\n{description}"
    )
    response = ollama.chat(
        model=model,
        messages=[{'role': 'user', 'content': prompt}]
    )
    raw = response['message']['content'].strip()
    if raw.startswith('1'):
        return 1
    elif raw.startswith('0'):
        return 0
    else:
        return -1  # model returned something unexpected — we'll drop these from the map


# ── Run classification ────────────────────────────────────────────────────────
print(f"Classifying {len(df)} listings with {GENERATION_MODEL}...")

labels = []
for i, desc in enumerate(df['description']):
    label = classify_listing(str(desc))
    labels.append(label)
    if (i + 1) % 25 == 0:
        valid = [l for l in labels if l != -1]
        pct_nbhd = sum(valid) / len(valid) * 100 if valid else 0
        print(f"  {i + 1}/{len(df)}  |  parse failures so far: {labels.count(-1)}"
              f"  |  {pct_nbhd:.0f}% neighborhood-forward")

df['neighborhood_forward'] = labels

print(f"\nDone.")
print(f"  Neighborhood-forward (1): {labels.count(1)}")
print(f"  Unit-forward        (0): {labels.count(0)}")
print(f"  Parse failures     (-1): {labels.count(-1)}")

# Preview — look at a few disagreements to gut-check the model
print("\nSample unit-forward listings:")
display(df[df['neighborhood_forward'] == 0][['address', 'neighborhood', 'description']].head(2))
print("\nSample neighborhood-forward listings:")
display(df[df['neighborhood_forward'] == 1][['address', 'neighborhood', 'description']].head(2))
```

When it finishes, take a look at the sample listings that print. Read the descriptions and see if you agree with the model's classification. It won't be perfect — this is a blunt instrument — but it should be directionally right most of the time.

### Step 1.3: Load Neighborhood Tabulation Areas

To map the classification results spatially, we need a geographic boundary layer. We'll use NYC's **Neighborhood Tabulation Areas (NTAs)**, which are the standard census sub-borough geography — granular enough to show variation within a borough, stable enough for comparison.

**Before running this cell:** download the NTA GeoJSON from NYC Open Data and save it to your `data/` folder as `nta_nyc.geojson`:

[https://data.cityofnewyork.us/api/geospatial/9nt8-h7nd?method=export&type=GeoJSON](https://data.cityofnewyork.us/api/geospatial/9nt8-h7nd?method=export&type=GeoJSON)

```python
nta_gdf = gpd.read_file('data/nta_nyc.geojson')
print(f"Loaded {len(nta_gdf)} NTAs")
print(f"Columns: {list(nta_gdf.columns)}")
```

Now we'll do a spatial join — the same operation you've done in QGIS and in the python tutorial, just with different datasets. We filter to Manhattan NTAs, convert our listings to a GeoDataFrame using their lat/lon coordinates, join each listing to the NTA polygon it falls within, and then compute the mean `neighborhood_forward` score per NTA.

```python
# Filter to Manhattan and reproject to match the listings CRS
manhattan_nta = nta_gdf[nta_gdf['boroname'] == 'Manhattan'].copy()
manhattan_nta = manhattan_nta.to_crs('EPSG:4326')
print(f"Manhattan NTAs: {len(manhattan_nta)}")

# Drop parse failures (-1) before the spatial join
df_valid = df[df['neighborhood_forward'] != -1].copy()
print(f"Listings with valid classification: {len(df_valid)}")

# Convert listings to GeoDataFrame using their lat/lon coordinates
listings_gdf = gpd.GeoDataFrame(
    df_valid,
    geometry=gpd.points_from_xy(df_valid['longitude'], df_valid['latitude']),
    crs='EPSG:4326'
)

# Spatial join: assign each listing to the NTA polygon it falls within
joined = gpd.sjoin(
    listings_gdf,
    manhattan_nta[['ntaname', 'geometry']],
    how='left',
    predicate='within'
)

# Aggregate: mean neighborhood_forward per NTA
nta_scores = (
    joined.groupby('ntaname')['neighborhood_forward']
    .agg(avg_neighborhood_forward='mean', listing_count='count')
    .reset_index()
)

print(f"\nNTAs with at least one listing: {len(nta_scores)}")
print("\nTop 5 most neighborhood-forward:")
print(nta_scores.sort_values('avg_neighborhood_forward', ascending=False)
      .head(5)[['ntaname', 'avg_neighborhood_forward', 'listing_count']]
      .to_string(index=False))
```

If you've done the spatial join tutorial in QGIS and the python tutorial, this should feel familiar — we're doing the same thing here (joining points to polygons), just with classification labels instead of tree counts.

### Step 1.4: Map the result

Now we'll build a choropleth of Manhattan NTAs. Each NTA is colored by its average `neighborhood_forward` score: pink means listings in that area tend to sell the location, green means they tend to sell the unit, gray means we didn't have any listings there.

```python
# Merge scores into the Manhattan NTA GeoDataFrame
manhattan_scored = manhattan_nta.merge(nta_scores, on='ntaname', how='left')

# The NTA source file contains Timestamp columns that can't be JSON-serialized.
# Keep only the columns the chart actually needs.
cols_needed = ['ntaname', 'geometry', 'avg_neighborhood_forward', 'listing_count']
nta_geojson = json.loads(manhattan_scored[cols_needed].to_json())

choropleth = alt.Chart(
    alt.InlineData(values=nta_geojson, format=alt.DataFormat(property='features', type='json'))
).mark_geoshape(
    stroke='white',
    strokeWidth=0.5
).encode(
    color=alt.condition(
        'isValid(datum.properties.avg_neighborhood_forward)',
        alt.Color(
            'properties.avg_neighborhood_forward:Q',
            scale=alt.Scale(
                range=['#52b788', '#ffffff', '#e07bb5'],
                domain=[0, 0.5, 1]
            ),
            legend=alt.Legend(
                title='',
                values=[0, 1],
                labelExpr="datum.value === 0 ? 'unit-forward' : 'neighborhood-forward'",
                gradientLength=150
            )
        ),
        alt.value('#d0d0d0')
    ),
    tooltip=[
        alt.Tooltip('properties.ntaname:N', title='NTA'),
        alt.Tooltip('properties.avg_neighborhood_forward:Q', title='Avg score', format='.2f'),
        alt.Tooltip('properties.listing_count:Q', title='# listings in sample')
    ]
).project('mercator').properties(
    width=450, height=550,
    title=alt.TitleParams(
        text='Listing orientation by neighborhood',
        subtitle='Green = unit-forward  |  White = even split  |  Pink = neighborhood-forward  |  Gray = no listings'
    )
)

choropleth
```

Take a look at the result. Does the pattern make sense to you? Areas where the neighborhood itself is a major draw (think the Village, the Upper West Side near the park) might lean neighborhood-forward, while areas where the buildings themselves are the selling point might lean the other way.

We can also export this scored NTA layer as a GeoJSON for use in other tools:

```python
# Export scored NTA boundaries to GeoJSON
out_path = 'data/nta_scored.geojson'
manhattan_scored[cols_needed].to_file(out_path, driver='GeoJSON')
print(f"Saved → {out_path}")

from IPython.display import FileLink
FileLink(out_path, result_html_prefix="Download: ")
```

## Part 2: Semantic Mapping with Embeddings

In Part 1 we used a language model as a classifier — we gave it instructions and asked for a label. In Part 2 we use a different kind of model to turn each description into a vector of numbers, and then use those vectors to build a map of *meaning* rather than geography.

### Step 2.1: Generate embeddings

We'll pass each listing description through an **embedding model** — a model trained specifically to convert text into vectors. This is a different job from Part 1's generation model, which was trained to produce text. Embedding models are trained to produce vectors that encode meaning.

If you're curious about how different embedding models compare, the benchmark to look at is the [MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard) (Massive Text Embedding Benchmark) on HuggingFace. For our use case (semantic similarity of short English texts), look at the "Semantic Textual Similarity" column.

We use `nomic-embed-text` (768 dimensions) as the default — it scores well on MTEB, runs locally via Ollama, and is small enough for a laptop. If you want something stronger, try `mxbai-embed-large` (1024 dims): `ollama pull mxbai-embed-large`. The HuggingFace fallback (`all-MiniLM-L6-v2`) produces 384-dimensional vectors — the code works with either, but embeddings from different models are not interchangeable.

**This step takes 10–20 minutes for ~250 listings in local mode.**

```python
# Load the dataset (allows this cell to run independently of Part 1)
df = pd.read_csv('data/streeteasy_full.csv')

# ---- LOCAL MODE (default) ----------------------------------------
# Calls Ollama running on your machine. Requires: ollama pull nomic-embed-text
# Produces 768-dimensional vectors.
def embed_local(text):
    response = ollama.embeddings(model='nomic-embed-text', prompt=text)
    return response['embedding']


# ---- HF API MODE (commented out) -----------------------------------
# Uncomment this block and set embed = embed_hf below to use HF instead.
# Produces 384-dimensional vectors — not compatible with local mode embeddings.
#
# HF_TOKEN = "YOUR_HF_TOKEN_HERE"  # paste your token from huggingface.co/settings/tokens
# hf_client = InferenceClient(token=HF_TOKEN)
#
# def embed_hf(text):
#     result = hf_client.feature_extraction(
#         text, model="sentence-transformers/all-MiniLM-L6-v2"
#     )
#     return result[0].tolist()  # result is a 2D array; take the first (and only) row


# Set the active embedding function here.
# To switch to HF mode: comment out the next line and uncomment the one after.
embed = embed_local
# embed = embed_hf


# ---- Run embeddings ------------------------------------------------
print(f"Generating embeddings for {len(df)} listings...")
print("(In local mode, expect ~10–20 minutes on a laptop.)")
print()

embeddings = []
for i, text in enumerate(df['description']):
    # str() guards against NaN values in the description column
    embeddings.append(embed(str(text)))
    # Print progress every 50 rows
    if (i + 1) % 50 == 0:
        print(f"  {i + 1} / {len(df)} listings processed...")

df['embedding'] = embeddings

print(f"\nDone. Each embedding has {len(df['embedding'].iloc[0])} dimensions.")
```

Once this finishes, each listing now has a 768-number vector associated with it. To get a feel for what these embeddings actually capture, let's compare the similarity of a few pairs of listings:

```python
# scipy's cosine() returns cosine *distance* (0 = identical, 2 = maximally different)
# We convert to similarity by subtracting from 1, so: 1 = identical, -1 = opposite
def cosine_sim(a, b):
    return 1 - cosine_distance(a, b)


# --- Pair 1: two randomly chosen listings ---
random_pair = df.sample(2, random_state=7)
idx_a, idx_b = random_pair.index.tolist()

sim_random = cosine_sim(df.loc[idx_a, 'embedding'], df.loc[idx_b, 'embedding'])

print("=" * 60)
print("PAIR 1: Two random listings")
print("=" * 60)
print(f"[A] {df.loc[idx_a, 'neighborhood']}")
print(df.loc[idx_a, 'description'][:250])
print()
print(f"[B] {df.loc[idx_b, 'neighborhood']}")
print(df.loc[idx_b, 'description'][:250])
print(f"\nCosine similarity: {sim_random:.4f}")


# --- Pair 2: two listings from the same neighborhood ---
same_nbhd_name = df['neighborhood'].value_counts().idxmax()
nbhd_pair = df[df['neighborhood'] == same_nbhd_name].sample(2, random_state=42)
idx_c, idx_d = nbhd_pair.index.tolist()

sim_nbhd = cosine_sim(df.loc[idx_c, 'embedding'], df.loc[idx_d, 'embedding'])

print()
print("=" * 60)
print(f"PAIR 2: Two listings from the same neighborhood ({same_nbhd_name})")
print("=" * 60)
print(f"[C] {df.loc[idx_c, 'description'][:250]}")
print()
print(f"[D] {df.loc[idx_d, 'description'][:250]}")
print(f"\nCosine similarity: {sim_nbhd:.4f}")

print()
print("--- Note: same-neighborhood listings are often more similar, but not always. ---")
print("--- Semantic similarity reflects *content*, not location. ---")
```

Read the descriptions that print and look at the cosine similarity scores. Listings from the same neighborhood are often more similar, but not always — semantic similarity reflects what the description *says*, not where the apartment is. That gap between geographic proximity and semantic proximity is what makes the rest of this tutorial interesting.

### Step 2.2: Dimensionality reduction with UMAP

We can't visualize 768 dimensions, so we need to compress them. **UMAP** (Uniform Manifold Approximation and Projection) is a dimensionality reduction algorithm that compresses high-dimensional data down to 2D (or 3D) while trying to preserve the neighborhood structure — points that are close in high-dimensional space should end up close in 2D.

The result is a "semantic map" of the dataset. Two listings that describe similar things will land near each other on this map even if they share no words and are in different neighborhoods. The axes have no geographic meaning; the only thing that matters is distance between points.

```python
# Stack all embedding vectors into a 2D numpy array: shape = (n_listings, n_dimensions)
embedding_matrix = np.array(df['embedding'].tolist())
print(f"Embedding matrix shape: {embedding_matrix.shape}")

# 2D UMAP — used for the scatter plots and geographic comparison
reducer_2d = umap.UMAP(n_neighbors=15, min_dist=0.1, n_components=2, random_state=42)
umap_2d = reducer_2d.fit_transform(embedding_matrix)
df['umap_x'] = umap_2d[:, 0]
df['umap_y'] = umap_2d[:, 1]

# 3D UMAP — used for interactive 3D exploration after clustering
reducer_3d = umap.UMAP(n_neighbors=15, min_dist=0.1, n_components=3, random_state=42)
umap_3d = reducer_3d.fit_transform(embedding_matrix)
df['umap_x3'] = umap_3d[:, 0]
df['umap_y3'] = umap_3d[:, 1]
df['umap_z3'] = umap_3d[:, 2]

print("UMAP complete (2D and 3D).")
```

Now let's plot the 2D projection, with each point colored by its StreetEasy neighborhood:

```python
# Altair scatter: each point is a listing, colored by StreetEasy neighborhood.
# Hover over any point to see the address, neighborhood, and rent.
# Use scroll to zoom, click-drag to pan.

umap_by_neighborhood = alt.Chart(df).mark_circle(size=40, opacity=0.75).encode(
    x=alt.X('umap_x:Q', axis=None, title=None),
    y=alt.Y('umap_y:Q', axis=None, title=None),
    color=alt.Color(
        'neighborhood:N',
        scale=alt.Scale(scheme='tableau20'),
        legend=alt.Legend(title='Neighborhood', columns=2, symbolLimit=50)
    ),
    tooltip=[
        alt.Tooltip('address:N', title='Address'),
        alt.Tooltip('neighborhood:N', title='Neighborhood'),
        alt.Tooltip('rent:Q', title='Rent', format='$,')
    ]
).properties(
    width=700, height=500,
    title='UMAP projection — colored by StreetEasy neighborhood'
).interactive()

umap_by_neighborhood
```

Notice how listings from the same neighborhood often cluster together, but not always. Some clusters cut across neighborhood lines, grouping listings by description *style* rather than location. That's the whole point — this map shows similarity of language, not similarity of geography.

### Step 2.3: Clustering

Now we'll use **k-means** to assign each listing to one of `k` clusters based on its position in embedding space. K-means works by repeatedly assigning each point to its nearest cluster center, then moving the center to the mean of all its assigned points, until stable.

This is different from what we did in Part 1, where we told the model what categories to use. Here, we're letting groupings emerge from the data itself. We choose `k` — try different values between 5 and 12 and see what changes. We cluster in the original high-dimensional space (not in the UMAP 2D), because UMAP compresses information and clustering there gives noisier results.

```python
# Try changing k between 5 and 12 to see how the clusters shift
k = 8

# L2-normalize the embedding vectors before clustering.
# This makes k-means use cosine similarity rather than Euclidean distance,
# which is more appropriate for text embeddings (we care about direction, not magnitude).
embedding_matrix_normalized = normalize(embedding_matrix, norm='l2')

# Fit k-means on the full high-dimensional normalized embeddings
kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
df['cluster'] = kmeans.fit_predict(embedding_matrix_normalized)

print(f"K-means complete (k={k}).")
print()
print("Listings per cluster:")
print(df['cluster'].value_counts().sort_index())
```

Let's visualize the clusters on the UMAP scatter:

```python
# Same UMAP scatter, now colored by k-means cluster assignment.

umap_by_cluster = alt.Chart(df).mark_circle(size=40, opacity=0.75).encode(
    x=alt.X('umap_x:Q', axis=None, title=None),
    y=alt.Y('umap_y:Q', axis=None, title=None),
    color=alt.Color(
        'cluster:O',
        scale=alt.Scale(scheme='tableau10'),
        legend=alt.Legend(title='Cluster')
    ),
    tooltip=[
        alt.Tooltip('address:N', title='Address'),
        alt.Tooltip('neighborhood:N', title='Neighborhood'),
        alt.Tooltip('cluster:O', title='Cluster #'),
        alt.Tooltip('rent:Q', title='Rent', format='$,')
    ]
).properties(
    width=700, height=500,
    title=f'UMAP projection — k-means clusters (k={k})'
).interactive()

umap_by_cluster
```

Compare this with the neighborhood-colored version from above. Where do the cluster boundaries align with neighborhood boundaries? Where do they diverge?

### Step 2.4: Auto-labeling clusters

Each cluster now has a number but no name. We'll ask the generation model to read a sample of listings from each cluster and describe what they have in common — in four words or fewer.

This is a much easier task for a small model than classifying individual listings: it's reading a group and naming a pattern, not making a fine judgment about a single item.

```python
n_samples = 30  # number of listings to show the model per cluster

cluster_labels = {}  # will hold { cluster_id: label_string }

for cluster_id in sorted(df['cluster'].unique()):
    # Get all listings in this cluster
    cluster_df = df[df['cluster'] == cluster_id]

    # Sample up to n_samples listings (use all if the cluster is small)
    sample_texts = cluster_df['description'].sample(
        min(n_samples, len(cluster_df)), random_state=42
    ).tolist()

    # Build a list of truncated descriptions for the prompt
    descriptions_block = "\n\n".join(
        [f"- {text[:300]}" for text in sample_texts]
    )

    # Ask what DISTINGUISHES this cluster, not what all listings share in general.
    prompt = (
        "You are labeling clusters in a semantic analysis of Manhattan apartment listing descriptions.\n\n"
        "The listings below were grouped together because they share a distinctive marketing angle or writing style. "
        "In 3–5 words, label what makes THIS cluster distinctive from other listings — "
        "what do these descriptions emphasize or lead with?\n\n"
        "Do NOT use the words 'apartment', 'rental', or 'unit'.\n"
        "Do NOT copy URLs, phone numbers, or contact details from the text.\n"
        "Return ONLY the label. No explanation.\n\n"
        f"Listings:\n{descriptions_block}"
    )

    response = ollama.chat(
        model=GENERATION_MODEL,
        messages=[{'role': 'user', 'content': prompt}]
    )
    label = response['message']['content'].strip()

    cluster_labels[cluster_id] = label

    # Print a summary so we can sanity-check the label
    print(f"\nCluster {cluster_id}: '{label}'  ({len(cluster_df)} listings)")
    for ex in sample_texts[:2]:
        print(f"  → {ex[:140]}...")

# Add label column to the dataframe
df['cluster_label'] = df['cluster'].map(cluster_labels)

print("\n" + "=" * 50)
print("All cluster labels:")
for cid, lbl in sorted(cluster_labels.items()):
    print(f"  Cluster {cid}: {lbl}")
```

Read through the labels and the sample descriptions. Do the labels make sense? Sometimes the model produces something too generic or too specific — you can always re-run this cell (it's fast) or change the prompt to push it in a different direction.

### Step 2.5: Map the results

Now the payoff. We'll look at the same listings through two lenses: a **geographic map** with listings placed at their real lat/lon, and a **3D semantic map** with listings placed in UMAP space. Both are colored by cluster.

Comparing the two is the point: where do geographic neighbors become semantic strangers? Which clusters appear everywhere in the city, and which are concentrated in specific areas?

First, the geographic map:

```python
# Filter out geocoding errors (coordinates outside Manhattan)
_in_manhattan = (
    (df['latitude']  >= 40.70) & (df['latitude']  <= 40.88) &
    (df['longitude'] >= -74.02) & (df['longitude'] <= -73.91)
)
df_geo = df[_in_manhattan].copy()
print(f"Using {len(df_geo)} of {len(df)} listings ({len(df) - len(df_geo)} excluded as geocoding errors)")

# Pre-compute a color map so all three figures use identical colors for each cluster label.
_T10 = px.colors.qualitative.T10
_clusters = sorted(df['cluster_label'].unique())
_color_map = {c: _T10[i % len(_T10)] for i, c in enumerate(_clusters)}

# Geographic map: listings at real lat/lon on a monotone tile basemap
geo_fig = px.scatter_mapbox(
    df_geo,
    lat='latitude',
    lon='longitude',
    color='cluster_label',
    color_discrete_map=_color_map,
    hover_name='address',
    hover_data={'neighborhood': True, 'rent': ':$,.0f', 'latitude': False, 'longitude': False},
    opacity=0.8,
    zoom=10.5,
    center={'lat': 40.775, 'lon': -73.97},
    title='Geographic map',
)
geo_fig.update_traces(marker=dict(size=7))
geo_fig.update_layout(
    mapbox_style='carto-positron',
    legend=dict(title='Cluster'),
    margin=dict(l=0, r=0, b=0, t=40),
    height=550,
)
geo_fig.show()
```

Now the 3D semantic map. This is interactive — drag to rotate, scroll to zoom, hover for details.

```python
sem_fig = px.scatter_3d(
    df,
    x='umap_x3', y='umap_y3', z='umap_z3',
    color='cluster_label',
    color_discrete_map=_color_map,
    hover_name='address',
    hover_data={
        'neighborhood': True,
        'rent': ':$,.0f',
        'umap_x3': False,
        'umap_y3': False,
        'umap_z3': False,
    },
    opacity=0.8,
    title='3D Semantic Map (UMAP — not geographic)',
)
sem_fig.update_traces(marker=dict(size=3))
sem_fig.update_layout(
    legend=dict(title='Cluster'),
    scene=dict(
        xaxis=dict(showticklabels=False, title=''),
        yaxis=dict(showticklabels=False, title=''),
        zaxis=dict(showticklabels=False, title=''),
    ),
    margin=dict(l=0, r=0, b=0, t=40),
    height=550,
)
sem_fig.show()
```

And finally, both side by side:

```python
from plotly.subplots import make_subplots
import plotly.graph_objects as go

fig_combined = make_subplots(
    rows=1, cols=2,
    specs=[[{'type': 'map'}, {'type': 'scene'}]],
    subplot_titles=['Geographic map', 'Semantic map (UMAP 3D — not geographic)'],
    column_widths=[0.5, 0.5],
)

for cluster in _clusters:
    color = _color_map[cluster]
    geo_sub = df_geo[df_geo['cluster_label'] == cluster]
    sem_sub = df[df['cluster_label'] == cluster]

    fig_combined.add_trace(
        go.Scattermap(
            lat=geo_sub['latitude'],
            lon=geo_sub['longitude'],
            mode='markers',
            marker=dict(size=7, color=color),
            name=cluster,
            legendgroup=cluster,
            text=geo_sub['address'],
            customdata=geo_sub[['neighborhood', 'rent']].values,
            hovertemplate='<b>%{text}</b><br>%{customdata[0]}<br>$%{customdata[1]:,.0f}<extra></extra>',
        ),
        row=1, col=1,
    )

    fig_combined.add_trace(
        go.Scatter3d(
            x=sem_sub['umap_x3'],
            y=sem_sub['umap_y3'],
            z=sem_sub['umap_z3'],
            mode='markers',
            marker=dict(size=3, color=color, opacity=0.8),
            name=cluster,
            legendgroup=cluster,
            showlegend=False,
            text=sem_sub['address'],
            customdata=sem_sub[['neighborhood']].values,
            hovertemplate='<b>%{text}</b><br>%{customdata[0]}<extra></extra>',
        ),
        row=1, col=2,
    )

fig_combined.update_layout(
    map=dict(
        style='carto-positron',
        center=dict(lat=40.775, lon=-73.97),
        zoom=10.5,
    ),
    scene=dict(
        xaxis=dict(showticklabels=False, title=''),
        yaxis=dict(showticklabels=False, title=''),
        zaxis=dict(showticklabels=False, title=''),
    ),
    height=600,
    legend=dict(title='Cluster'),
    title=dict(
        text='Geographic vs. Semantic — same color = same cluster. Where do geographic neighbors become semantic strangers?',
        x=0.5,
        xanchor='center',
    ),
    margin=dict(t=60, l=0, r=0, b=0),
)

fig_combined.show()
```

Spend some time with this combined view. Rotate the 3D semantic map and hover over points. Find two listings that are geographically close but in different semantic clusters, and read their descriptions. Find two that are geographically far apart but in the same cluster. What's going on in the language that connects or separates them?

## What's next

The UMAP coordinates, cluster labels, and `neighborhood_forward` classifications you've generated are the starting point for the next tutorial, where we'll use a web-first approach — working with Claude as a coding collaborator — to build an interactive web visualization of this dataset.

---
Module by Adam Vosburgh, Spring 2026.
