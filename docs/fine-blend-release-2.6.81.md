# Fine blend profile (2.6.81)

## Why

Blends are made by alternating whole layers of different reels. At the model's own layer height, with one pattern through every wall, that shows as stripes, and each colour is only as deep as one wall.

Tools that get smoother colour from the same reels do three things: print thin layers, print several thin walls, and use a different layer pattern for the walls behind the outer one. This release does the same, using the slicer's own blend table.

## What the switch does

| Setting | Value |
| --- | --- |
| Layer height | 0.10 mm |
| Walls | 5 (more if the project already had more) |
| Wall line width | 0.3 mm, outer and inner |
| Subdivide Mix Layer | off: each layer is already one reel of the pattern |
| Blend rows | an outer-wall repeat and an offset inner-wall repeat |

A blend of 40% reel 3 and 60% reel 4 is written as:

```
1,2,1,1,0,0,g34,w40/60,m0,z0,xa0,xb0,d0,o0,u1,cm1,43434,34344
```

`43434` is the outer wall, layer by layer. `34344` is every wall behind it: the same shares, started at a different layer.

## Limits

- Snapmaker Orca output only.
- Not with dual-wall mixing, which fills the inner walls with one reel instead.
- The 3D preview does not show the patterns.
- Colour predictions are still estimates from the reels' nominal colours. A printed swatch card is the planned next step.

## Not yet confirmed

The row format follows the open-source slicer code and projects Snapmaker Orca opens. It has not been sliced or printed from YAB3D. Slice a small test and check that the outer and inner walls show different reels on the same layer.

## Update, 2.6.94

The inner-wall pattern described above is no longer written. Snapmaker Orca stopped with an access violation when slicing a painted model exported that way. Each blend is now one layer pattern; the layer height and wall settings are unchanged.
