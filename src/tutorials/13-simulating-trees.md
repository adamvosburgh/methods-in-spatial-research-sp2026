---
title: Simulating Trees
date: "2026-04-01"
author: Adam Vosburgh
sequence: 13
cat: tutorial
published: true
---

This tutorial builds directly on Tutorial 9. We'll use the same two datasets — the 2015 NYC Street Tree Census and the census block group shapefile — and repeat the same spatial join. The difference is what we do before the join. Instead of just counting trees, we'll estimate two ecological services each tree provides: stormwater interception and CO₂ sequestration. Then we'll aggregate those benefit estimates spatially to see which neighborhoods are getting the most (and least) out of the city's urban forest.

The calculations follow the methodology of [i-Tree Eco](https://www.itreetools.org/) (Nowak et al. 2008), a widely-used urban forestry model from the USDA Forest Service, using published allometric equations from the peer-reviewed literature. One thing to be clear about upfront: the individual numbers are **model estimates, not direct measurements**. Each tree's benefit is inferred from its trunk diameter and health condition rather than measured in the field. What matters for this tutorial isn't the precision of any individual estimate — it's the *pattern* across the city, and what that pattern might tell us about where ecological infrastructure is concentrated and where it isn't.

Both files you need are the same ones from Tutorial 9:

- `2015_Street_Tree_Census_subset_um.csv`
- `nycb2010_um.gpkg`

Make sure both are in a `data/` folder in the same directory as this notebook before running.

## Environment setup

### Installing conda

This tutorial uses `geopandas`, which depends on some native geospatial libraries (GDAL, PROJ, Fiona) that are much more reliable to install through conda than pip. If you already have conda set up from a previous tutorial, skip ahead to the next section.

If not, install **Miniconda** — it's the smallest version that gives you what you need. Download the installer from [anaconda.com/download](https://www.anaconda.com/download/success?reg=skipped) and run it with all default settings.

On MacOS, after it finishes installing, run this to refresh your terminal session:

```bash
source ~/.zshrc
```

Then verify it worked:

```bash
conda --version
```

You should see a version number. Once that works, proceed below.

### Creating the conda environment

We'll use a `environment.yml` file to set up the environment. Create that file in your tutorial folder and paste the following into it:

```yaml
name: street-trees
channels:
  - conda-forge
  - defaults
dependencies:
  - python
  - numpy
  - pandas
  - geopandas
  - altair
  - ipykernel
```

`conda-forge` is listed first because it carries the most up-to-date geospatial builds. `ipykernel` is what lets you run the notebook in VS Code.

Open a terminal, navigate to your tutorial folder, and run:

```bash
conda env create -f environment.yml
```

This will take a few minutes the first time. Once it's done:

```bash
conda activate street-trees
```

Your terminal prompt will change to show `(street-trees)`. Then register the environment as a Jupyter kernel so VS Code can find it:

```bash
python -m ipykernel install --user --name street-trees --display-name "street-trees"
```

You only need to do this once. After that, open the notebook in VS Code, click the kernel selector in the top-right corner, click "Jupyter Kernel...", and choose **street-trees**. If you don't see it, close and reopen VS Code. Once the kernel is selected, you're ready to run.

## Setup

Same imports as Tutorial 9, with `numpy` added — we need it for the logarithm in the CO₂ calculation.

```python
import numpy as np
import pandas as pd
import geopandas as gpd
import altair as alt

# Altair defaults to a 5,000-row limit; disable it since our dataset is larger
alt.data_transformers.disable_max_rows()
```

## Step 1: Load the data

Load the street tree CSV exactly as in Tutorial 9. The columns we'll use most are `tree_dbh` (diameter at breast height, in inches), `spc_common` (species name), `health` (Good / Fair / Poor), and the lat/lon coordinates.

DBH is the single most important variable here — nearly every ecological benefit estimate we calculate traces back to it.

```python
df_StreetTree = pd.read_csv('data/2015_Street_Tree_Census_subset_um.csv')

# Preview the data
df_StreetTree.head()
```

Before calculating anything, let's check for trees with DBH = 0. These are stump records or missing data — we don't want them skewing the allometric equations, so we'll replace them with `NaN`:

```python
# Check how many trees have DBH = 0 — these are stump or missing records
zero_dbh_count = (df_StreetTree['tree_dbh'] == 0).sum()
print(f"Trees with DBH = 0: {zero_dbh_count} ({zero_dbh_count / len(df_StreetTree) * 100:.1f}% of records)")

# Replace 0 with NaN so downstream equations return NaN instead of incorrect values
df_StreetTree['tree_dbh'] = df_StreetTree['tree_dbh'].replace(0, np.nan)
```

## Step 2: Crown projection area from DBH

Before we can estimate any ecological benefit, we need to know how large each tree's canopy is. The goal here is **crown projection area** (CPA) — the footprint of the canopy as seen from above, modeled as a circle. CPA is the foundation for everything that follows: leaf area, stormwater interception, and CO₂ sequestration all trace back to it.

i-Tree estimates crown area using species-specific lookup tables matched to climate zones — for each of hundreds of species, it has empirically fitted equations relating trunk diameter to crown width. Replicating that in this notebook would require mapping every `spc_common` value in the census to an i-Tree species code, then pulling the right equation for each one. That's a significant undertaking and not the point of this tutorial.

Instead, we use a single generalized **power-law equation** applied to all trees:

`crown_width (m) = a × DBH_cm ^ b`

The coefficients (a = 1.22, b = 0.65) are approximate values for deciduous urban trees, chosen to produce reasonable estimates across the DBH range in this dataset — a 10 cm DBH tree gets a crown width of about 5.5 m, a 30 cm tree about 9.5 m, which is in the right range for open-grown urban trees. These aren't from a single citable source; they're a generalized estimate.

This is an approximation and should be understood as one. It will over- or under-estimate individual trees. But because the same equation applies to every tree in the dataset, the *relative differences* across the city — which block groups have more canopy, which have less — are still meaningful. The spatial pattern holds even when the absolute numbers are approximate.

```python
# Convert DBH from inches to cm
df_StreetTree['dbh_cm'] = df_StreetTree['tree_dbh'] * 2.54

# Estimate crown width (m) from DBH using a generalized power-law equation
# crown_width = a * dbh_cm^b
# Coefficients (a=1.22, b=0.65) are approximate values for deciduous urban trees —
# i-Tree does this with species-specific lookup tables; this is a simplified stand-in
a = 1.22
b = 0.65
df_StreetTree['crown_width_m'] = a * (df_StreetTree['dbh_cm'] ** b)

# Crown projection area (m²) — the footprint of the canopy, modeled as a circle
df_StreetTree['crown_area_m2'] = 3.14159 * (df_StreetTree['crown_width_m'] / 2) ** 2

# Quick sanity check: median crown area
print(f"Median crown projection area: {df_StreetTree['crown_area_m2'].median():.1f} m²")
print(f"Max crown projection area: {df_StreetTree['crown_area_m2'].max():.1f} m²")
```

## Step 3: Leaf area from crown projection area

Crown projection area tells us the footprint of the canopy, but what matters ecologically is the total surface area of leaves — because leaves are where photosynthesis, transpiration, and rainfall interception actually happen.

Leaf area is estimated from crown projection area using a **Leaf Area Index (LAI)** multiplier. LAI is the ratio of total leaf area to the ground area covered by the crown (m² of leaf per m² of crown footprint). An LAI of 4.0 means there are effectively 4 m² of leaf surface stacked above every 1 m² of crown footprint.

Following Nowak (1996), LAI varies with tree condition — a tree in poor health has fewer, less functional leaves than a healthy one. So rather than applying a single constant, we use condition-adjusted values.

```python
# LAI multiplier by health condition (from Nowak 1996 methodology)
# Good condition: LAI ≈ 4.0  |  Fair: ≈ 2.5  |  Poor: ≈ 1.0
# Trees with no health record (NaN) get 0.0 — they contribute no leaf area
lai_map = {'Good': 4.0, 'Fair': 2.5, 'Poor': 1.0}
df_StreetTree['lai'] = df_StreetTree['health'].map(lai_map).fillna(0.0)

# Total leaf area (m²) = crown footprint × LAI
df_StreetTree['leaf_area_m2'] = df_StreetTree['crown_area_m2'] * df_StreetTree['lai']

# Verify condition breakdown
print(df_StreetTree['health'].value_counts(dropna=False))
```

## Step 4: Stormwater interception

One of the most economically significant services street trees provide is **intercepting rainfall** before it reaches the ground. In a dense urban environment like New York, stormwater that hits impervious surfaces flows directly into the combined sewer system, which can overflow during heavy rain — releasing untreated sewage into waterways. Trees reduce that volume.

For this tutorial, we apply an annual interception fraction (15% of precipitation) to leaf area — a conservative estimate based on i-Tree Eco validation data, where modeled interception averaged 61% across sites. The full model uses hourly rainfall data, evaporation rates, and canopy storage capacity; our version captures the order of magnitude while staying interpretable.

NYC gets about 1,181 mm of rain per year (NOAA 30-year normal). We'll calculate intercepted volume in gallons per year — a useful and concrete unit. For context, NYC Parks and the USDA Forest Service estimated from the 2015 street tree census that NYC's roughly 666,000 street trees together intercept about 916 million gallons per year, with a stormwater benefit of approximately $35 million annually (calculated using i-Tree Streets). That gives a rough sense of scale for the numbers your code will produce.

```python
# NYC annual precipitation: 1,181 mm (NOAA, 30-year normal 1991–2020)
# Interception fraction: ~15% of annual precipitation for deciduous trees
nyc_annual_precip_m = 1.181   # meters
interception_fraction = 0.15  # conservative midpoint from i-Tree validation range

df_StreetTree['stormwater_m3_yr'] = (
    df_StreetTree['leaf_area_m2'] * nyc_annual_precip_m * interception_fraction
)

# Convert m³ to gallons (1 m³ = 264.17 gallons)
df_StreetTree['stormwater_gal_yr'] = df_StreetTree['stormwater_m3_yr'] * 264.17

# Summary statistics
print(f"Total stormwater intercepted per year: {df_StreetTree['stormwater_gal_yr'].sum():,.0f} gallons")
print(f"Median per-tree interception: {df_StreetTree['stormwater_gal_yr'].median():,.0f} gal/yr")
print(f"(NYC Parks / i-Tree Streets 2015 estimate for all ~666k trees: 916 million gal/yr)")
```

## Step 5: CO₂ sequestration

Trees sequester carbon as they grow, converting atmospheric CO₂ into woody biomass. We estimate annual CO₂ sequestration in three steps, following Nowak & Crane (2002):

1. Estimate **aboveground dry weight biomass** from DBH using an allometric equation (Jenkins et al. 2003 — mixed hardwood equation)
2. **Carbon storage** = 0.5 × dry biomass (approximately half of wood dry weight is carbon)
3. **Annual sequestration** = carbon storage × annual growth rate, then converted from C to CO₂

We apply a fixed 4% annual growth rate — a conservative estimate for open-grown urban trees. The full i-Tree method uses species-specific growth rates by climate zone, which would be more precise. For the dollar value we use the **EPA Social Cost of Carbon** at $51/metric ton (Obama-era baseline; the Biden-era figure was ~$190/metric ton). Unlike the stormwater case, this is a verifiable published figure — though it represents a policy estimate, not a market price, and the number has shifted significantly across administrations.

```python
# Aboveground dry weight biomass (kg) — Jenkins et al. 2003, mixed hardwood equation
# biomass = exp(β₀ + β₁ * ln(dbh_cm))
# Mixed hardwood coefficients (β₀ = -2.4800, β₁ = 2.4835) — appropriate for NYC's
# predominantly hardwood street tree population (London plane, Norway maple, Callery pear, etc.)
df_StreetTree['biomass_kg'] = np.exp(
    -2.4800 + 2.4835 * np.log(df_StreetTree['dbh_cm'])
)

# Carbon storage (kg C) = 0.5 × biomass (Nowak & Crane 2002)
df_StreetTree['carbon_kg'] = df_StreetTree['biomass_kg'] * 0.5

# Annual sequestration: 4% annual growth rate, converted kg C → kg CO₂
# Multiply by 3.667 (molecular weight ratio of CO₂/C = 44/12)
df_StreetTree['co2_seq_kg_yr'] = df_StreetTree['carbon_kg'] * 0.04 * 3.667

# Dollar value: EPA social cost of carbon at $51/metric ton (conservative baseline)
df_StreetTree['co2_value_usd'] = (df_StreetTree['co2_seq_kg_yr'] / 1000) * 51

# Summary statistics
print(f"Total CO₂ sequestered per year: {df_StreetTree['co2_seq_kg_yr'].sum():,.0f} kg")
print(f"Total CO₂ value per year: ${df_StreetTree['co2_value_usd'].sum():,.0f}")
print(f"Median per-tree sequestration: {df_StreetTree['co2_seq_kg_yr'].median():.1f} kg CO₂/yr")
```

## Step 6: Map individual trees colored by stormwater benefit

Before we aggregate to block groups, let's look at the per-tree data. The color encodes annual stormwater interception (gallons/year); point size encodes DBH, the same as Tutorial 9.

```python
chart_StreetTree_Storm = alt.Chart(df_StreetTree).mark_circle().encode(
    longitude='longitude:Q',
    latitude='latitude:Q',
    color=alt.Color(
        'stormwater_gal_yr:Q',
        scale=alt.Scale(scheme='blues'),
        legend=alt.Legend(title='Stormwater (gal/yr)')
    ),
    size=alt.Size(
        'tree_dbh:Q',
        scale=alt.Scale(range=[0, 228]),
        legend=alt.Legend(title='DBH (inches)')
    ),
    tooltip=[
        alt.Tooltip('spc_common:N', title='Species'),
        alt.Tooltip('tree_dbh:Q', title='DBH (in)', format='.1f'),
        alt.Tooltip('health:N', title='Health'),
        alt.Tooltip('stormwater_gal_yr:Q', title='Stormwater (gal/yr)', format=',.0f'),
        alt.Tooltip('co2_seq_kg_yr:Q', title='CO₂ sequestered (kg/yr)', format='.1f')
    ]
).project(
    type='mercator'
).properties(
    width=1000,
    height=1000,
    title='Individual Trees: Annual Stormwater Interception'
)

chart_StreetTree_Storm
```

Hover over a few trees. Notice how much the stormwater value varies — a large healthy tree can intercept many times more rainfall than a small or poor-condition one.

## Step 7: Spatial join to block groups and aggregate

Now we follow the exact same spatial join pattern as Tutorial 9 — the only difference is that instead of just counting trees, we're also summing up benefit estimates. Here's the sequence:

1. Convert the street tree dataframe to a GeoDataFrame using lat/lon
2. Load the block group GeoPackage
3. `sjoin` the two (keeping the structure of the street trees)
4. `groupby` block group to count trees and sum benefits
5. Merge back to the block group GeoDataFrame for polygon geometry

```python
# Load block groups — same file and reprojection as Tutorial 9
gdf_BlockGroup = gpd.read_file('data/nycb2010_um.gpkg').to_crs(epsg=4326)

gdf_BlockGroup.head()
```

```python
# Convert df_StreetTree to a GeoDataFrame — same pattern as Tutorial 9
gdf_StreetTree = gpd.GeoDataFrame(
    df_StreetTree,
    geometry=gpd.points_from_xy(df_StreetTree['longitude'], df_StreetTree['latitude']),
    crs='EPSG:4326'
)

# Spatial join: attach block group ID to each tree row
gdf_joined = gpd.sjoin(gdf_BlockGroup, gdf_StreetTree, how='right', predicate='contains')

# Aggregate per block group: count trees, sum benefits
gdf_agg = gdf_joined.groupby('CT2010').agg(
    tree_count=('tree_id', 'count'),
    total_stormwater_gal=('stormwater_gal_yr', 'sum'),
    total_co2_kg=('co2_seq_kg_yr', 'sum')
).reset_index()

# Average stormwater per tree — shows where individual trees are working hardest,
# independent of how many trees a block group has
gdf_agg['stormwater_per_tree'] = gdf_agg['total_stormwater_gal'] / gdf_agg['tree_count']

# Merge aggregated values back to the block group GeoDataFrame
gdf_BenefitBlocks = gdf_BlockGroup.merge(gdf_agg, on='CT2010', how='left')

# Fill block groups with no trees with 0 rather than NaN
gdf_BenefitBlocks[['tree_count', 'total_stormwater_gal', 'total_co2_kg', 'stormwater_per_tree']] = (
    gdf_BenefitBlocks[['tree_count', 'total_stormwater_gal', 'total_co2_kg', 'stormwater_per_tree']]
    .fillna(0)
)

print(f"Block groups with at least one tree: {(gdf_BenefitBlocks['tree_count'] > 0).sum()}")
print(f"Total block groups: {len(gdf_BenefitBlocks)}")
gdf_BenefitBlocks[['CT2010', 'tree_count', 'total_stormwater_gal', 'total_co2_kg', 'stormwater_per_tree']].head(10)
```

## Step 8: Three choropleths

Now let's map the three aggregated metrics. The first two (total stormwater, total CO₂) show where the city gets the most ecological work done. The third — stormwater per tree — is the interesting one: it removes the effect of tree count and shows where individual trees are working hardest, regardless of how many there are.

```python
# Shared base chart properties
base = alt.Chart(gdf_BenefitBlocks).mark_geoshape(
    stroke='black',
    strokeWidth=0.3
).project(
    type='mercator'
).properties(
    width=500,
    height=600
)

# Chart 1: Total stormwater benefit per block group (blue)
chart_Stormwater = base.encode(
    color=alt.Color(
        'total_stormwater_gal:Q',
        scale=alt.Scale(scheme='blues'),
        legend=alt.Legend(title='Total Stormwater (gal/yr)')
    ),
    tooltip=[
        alt.Tooltip('CT2010:N', title='Block Group'),
        alt.Tooltip('tree_count:Q', title='Tree Count'),
        alt.Tooltip('total_stormwater_gal:Q', title='Stormwater (gal/yr)', format=',.0f')
    ]
).properties(
    title='Total Stormwater Benefit'
)

chart_Stormwater
```

```python
# Chart 2: Total CO₂ sequestered per block group (green)
chart_CO2 = base.encode(
    color=alt.Color(
        'total_co2_kg:Q',
        scale=alt.Scale(scheme='greens'),
        legend=alt.Legend(title='Total CO₂ (kg/yr)')
    ),
    tooltip=[
        alt.Tooltip('CT2010:N', title='Block Group'),
        alt.Tooltip('tree_count:Q', title='Tree Count'),
        alt.Tooltip('total_co2_kg:Q', title='CO₂ (kg/yr)', format=',.0f')
    ]
).properties(
    title='Total CO₂ Sequestered'
)

chart_CO2
```

```python
# Chart 3: Stormwater per tree — where individual trees are working hardest
chart_StormPerTree = base.encode(
    color=alt.Color(
        'stormwater_per_tree:Q',
        scale=alt.Scale(scheme='teals'),
        legend=alt.Legend(title='Stormwater per Tree (gal/yr)')
    ),
    tooltip=[
        alt.Tooltip('CT2010:N', title='Block Group'),
        alt.Tooltip('tree_count:Q', title='Tree Count'),
        alt.Tooltip('stormwater_per_tree:Q', title='Stormwater per Tree (gal/yr)', format=',.0f')
    ]
).properties(
    title='Stormwater per Tree'
)

chart_StormPerTree
```

## Step 9: Reflection

Look at the three maps and think through what each one is actually showing.

Before you do, a quick anchor for the numbers. NYC Parks and the USDA Forest Service estimated from the 2015 census that NYC's ~666,000 street trees intercept about 916 million gallons of stormwater per year — a benefit valued at roughly $35 million annually using i-Tree Streets. Your subset covers upper Manhattan only, so your totals will be much smaller, but the per-tree figures should be in a similar range.

The first two maps (total stormwater, total CO₂) will tend to track the *number* of trees — block groups with more trees simply generate more total benefit. The more interesting question is whether the distribution of trees matches the distribution of need. Which neighborhoods have the most trees, and which have the fewest? Does that pattern correspond to differences in income, race, or historical investment? (If you've looked at the redlining maps from earlier in the course, you already have some hypotheses.)

The stormwater-per-tree map removes the effect of count. A block group with a high per-tree value has large, healthy trees that are individually providing significant benefit. A block group with a low per-tree value may have many small or poor-condition trees. Where are the high-performing individual trees located relative to the areas that need the most infrastructure relief?

There's a broader methodological point worth sitting with. When researchers or city agencies report that NYC's street trees provide $151M/year in ecological benefits, that number is technically accurate — but it's an average distributed across the whole city. These maps show that the distribution is far from even. A single aggregate figure can be used to justify *any* planting strategy, including ones that concentrate resources where they're already concentrated. The spatial pattern is the analysis; the number is just the headline.

If you wanted to shift the benefit map toward underserved areas, you have two levers: number of trees (planting more) and quality of trees (prioritizing larger species, better stewardship, fewer removals). Which is more tractable in a dense urban environment? What constraints — sidewalk width, underground utilities, maintenance budgets — would shape where new trees can actually go?

---
Module by Adam Vosburgh, Spring 2026. 
