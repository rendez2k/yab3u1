# Baked colours (2.6.78)

## What it does

Full Spectrum blends could only mix two reels per colour. With four reels of cyan, magenta, yellow and white, that leaves out every colour that needs three: skin tones (magenta + yellow + white), browns (cyan + magenta + yellow) and most muted shades.

**Baked colours** lets the planner use three reels for a colour when that is closer than any pair. It is a checkbox under Blend detail in the Colours panel, off by default.

## How it is written

Snapmaker Orca's blend table accepts a row that names the reel for each layer of a repeat. YAB3D writes a three-reel blend as such a row:

```
1,2,1,1,20,0,g234,w20/20/60,m0,z0,xa0,xb0,d0,o0,u4,cm1,42434
```

The last field is the repeat: reel 4, 2, 4, 3, 4, then again. The model itself is untouched: the same paint, the same geometry, and the same 16 colour slots as before.

Shares are whole layers. Blend detail sets the longest repeat: 4 layers for Standard, 6 for Strong, 8 for Finest. The order within a repeat is chosen so the longest run of one reel is as short as possible.

## What to expect

- A repeat of six 0.16 mm layers is about 1 mm tall, so stripes can show. Thinner layers (0.08–0.12 mm) blend better. Subdivide Mix Layer applies to two-reel blends only.
- The limit of 12 blended colours per export on the U1 still applies. Baked colours makes each of those 12 a better match; it does not add more.
- Suggested reel sets are still ranked by what pairs can reach. Choosing a CMY + White pack and turning Baked colours on gives the fullest effect.
- Predicted colours for three reels are uncalibrated estimates.

## Not yet confirmed

The row format was taken from the open-source slicer code and from projects that Snapmaker Orca opens. It has not been sliced or printed from YAB3D. Slice a small test first and check the preview shows the three reels alternating by layer.
