# Town GLB asset shortlist

Date: 2026-09-26. Task: PT-122. Feature: ORCH-06; Web Town only. Research, not an asset import or visual acceptance.

## Existing fit

Town renders procedural Chola/Kaveri-inspired Three.js buildings, temple, props and articulated artisans (`web/app/town/town-assets.ts`). Its figures are actual agents, not ambient villagers. An external asset should replace or enrich a named asset without creating fictional workers or altering agent truth. The original historical direction is in `docs/superpowers/plans/2026-09-13-town-landscape-plan.md`.

## Best scenery candidates

| Candidate | Source | License on listing | Listing size | Fit |
|---|---|---|---:|---|
| South Indian Temple Modular Kit | https://sketchfab.com/3d-models/south-indian-temple-modular-kit-25f0176668004faa98ec351e04e58920 | CC BY | 8.3k triangles | Best first pilot: low-poly reusable architectural detail; creator says it is South Indian-style, not a specific historic temple. Test as detail around current temple, not a replacement for its site geometry. |
| Traditional House Designing | https://sketchfab.com/3d-models/traditional-house-designing-a6318786f4d040b8b7c6f12929cf3fce | CC BY | 10k triangles | Promising house silhouette; inspect textures, scale and historical appropriateness. |
| Indian House Old | https://sketchfab.com/3d-models/indian-house-old-3beb064c1ae841c5beb556b5aa267036 | CC BY | 35.6k triangles | Creator calls it South Indian and lower quality; suitable possible distant building after visual check and optimization. |

## Human and saint candidates

| Candidate | Source | License on listing | Listing size | Role and caveat |
|---|---|---|---:|---|
| Villager Walking | https://sketchfab.com/3d-models/villager-walking-d1667a967a5d49478c14d9976f55b9ea | CC BY | 9.1k triangles | Best animated-human pilot; listing describes an Indian villager walking. Inspect rig, animation clip, clothing and silhouette before use as a named agent. |
| Indian Male Character | https://sketchfab.com/3d-models/indian-male-character-a311adcb82a3457db16a548a8d261114 | CC BY | 77.9k triangles | Traditional festival clothing, Blender source with shape keys. Needs decimation/retopology and rig check; not established as period dress. |
| Indian woman in traditional saree outfit | https://sketchfab.com/3d-models/indian-woman-in-traditional-saree-outfit-895a6682c82245058f408da36a80cb75 | CC BY | 170.9k triangles | Explicit GLTF/GLB on listing; useful visual reference, too heavy for repeated Town figures without optimization. Period/rig unverified. |
| Saint Sundarar, Chola-period bronze scan | https://sketchfab.com/3d-models/saint-sundarar-carnegie-museum-of-art-bc57a6fab9d34ac6b956d2df84c18a26 | CC BY-NC | 223.9k triangles | Historically relevant 13th-century saint sculpture. Static museum object, not a walkable human; noncommercial restriction needs product-use review. |
| Indian sage 1 | https://sketchfab.com/3d-models/indian-sage-1-269d3b7c84fb44989a295862565150a1 | CC BY | 788.1k triangles | AI-generated, very heavy. Weak production candidate; silhouette reference only. |

Sketchfab states downloadable models are available as glTF, and its download API lists GLB; downloads require account authentication: https://sketchfab.com/features/gltf and https://sketchfab.com/developers/download-api. A model listing's download badge is not proof that its downloaded GLB, animation and textures work in Town. CC BY requires attribution; preserve author, title, source URL, license and modifications in an asset manifest. The CC BY-NC Sundarar scan should not be shipped without resolving product-use eligibility.

## Recommended trial

1. Obtain the modular temple kit and Villager Walking through the source download flow. Inspect actual GLB, materials, animations, bounds and license files.
2. Render them in an isolated Town fixture with current day/night lighting and camera distances. Keep existing procedural assets as fallback.
3. Set a performance budget from measured current scene and target devices before adding repeated models. Optimize textures and mesh count; keep buildings/collision and named-agent state authoritative.

No models were downloaded or integrated in this research pass. No tests were run because product code was unchanged.

## Follow-up: scientists, mages, and craft roles (PT-123)

The Town cast includes planner Chanakya, designer Maya Danava, builder Vishwakarma, reviewer Panini, tester Aryabhata, debugger Sushruta, researcher Gargi, scribe Ganesha and guardian Nandi. These external models are visual candidates for roles, not literal depictions of those named people or deities.

| Candidate | Source | License on listing | Listing size | Fit and animation evidence |
|---|---|---|---:|---|
| Low Poly Wizard (Rigged) | https://sketchfab.com/3d-models/low-poly-wizard-rigged-f8c91af65aec4779b0e3d857b1878cc2 | CC BY | 1.1k triangles | Strong mage candidate for Maya Danava; creator lists idle, walk and attack clips. Verify GLB clips and use nonviolent idle/walk only. |
| Scientist PSX style | https://sketchfab.com/3d-models/scientist-psx-style-0176c8a563dd45e29dcd58ea85f43853 | CC BY | 748 triangles | Strong lightweight researcher/tester candidate; listing says humanoid rig, but no included walk clip is claimed. Modern lab coat clashes with historic Town unless purposefully used for a distinct science district. |
| Low Poly Blacksmith (Rigged) | https://sketchfab.com/3d-models/low-poly-blacksmith-rigged-aa7bcc0cbbbd477c9f3af689f37a728f | CC BY | 880 triangles | Strong craftsperson for Vishwakarma or a builder apprentice; same creator/style as wizard, lists idle/walk/attack. Hammer and medieval dress need visual check against Tamil setting. |
| Low Poly Wizard Girl | https://sketchfab.com/3d-models/low-poly-wizard-girl-f432be31444a4063aa2e24e28a123e6d | CC BY | 2.1k triangles | Rigged woman mage candidate; animation clips not stated. Could support a distinct Gargi figure after clothing/style review. |
| Poly-Art Wizard Medieval Fantasy | https://sketchfab.com/3d-models/poly-art-wizard-medieval-fantasy-01d1bacb3e9942cdb8808481ea9cb2f7 | CC BY | 2.8k triangles | Mage with staff and compact palette texture; basic humanoid rig, no animation clips claimed. |
| Whispering Wizard (Animated) | https://sketchfab.com/3d-models/whispering-wizard-animated-b14d316dd0554230af8fe930f2a8fc8c | CC BY | 8.2k triangles | Humanoid rig and basic animations; potentially richer close-up, higher cost than the first wizard. |
| Low poly man working at a table with a laptop | https://sketchfab.com/3d-models/low-poly-man-working-at-a-table-with-a-laptop-be6b2404359c474fb0ed148e1882516e | CC BY | 7.4k triangles | Possible stationary workshop vignette; modern laptop and person must not create a fictional worker. |
| Standard character template (fully rigged) | https://sketchfab.com/3d-models/standard-character-template-fully-rigged-e959b554d5c14f68a06e52d0d06f0f1d | CC BY | 450 triangles | Small customizable rigged base for coherent original role-specific clothing/accessories, but requires asset authoring. |

Avoid the tempting `Scholar Rigged 3D Model` download at https://sketchfab.com/3d-models/scholar-rigged-3d-model-a8efd688ec4b472f90558331d59c0573 as a ready-to-animate GLB: its creator explicitly says the Sketchfab version has **no rig**. Also avoid the `Half-Life 1 Scientist` reupload: its description attributes the source to Valve, so the uploader's CC BY label does not establish original rights.

Priority trial: wizard + blacksmith as a coherent pair, then scientist if a deliberate cross-era style is desired. Inspect downloaded files for actual GLB animation clips, texture sizes, bone count, license metadata and appearance beside the current artisan figures. No asset downloaded or imported in this follow-up.

## Villager adaptation feasibility (PT-124)

On 2026-09-26 the public Sketchfab model API for `d1667a967a5d49478c14d9976f55b9ea` reported `isDownloadable: true`, CC BY 4.0 (commercial use allowed with author credit), 9,102 faces, 4,535 vertices and one animation. An unauthenticated request to its download endpoint returned HTTP 401, so the actual GLB, texture layout, skeleton and animation clip were not inspected.

Likely safe first variant: one licensed base model with distinct palette, turban/head wrap, shawl, jewelry and handheld tools created as separate low-poly attachments, preserving its walk clip and silhouette. A stronger role-specific variant may require editing the source mesh, UVs and skin weights in Blender and exporting new GLBs. Confidence is high for palette/accessory differentiation, conditional for seamless outfit remodeling until the file and rig are inspected. Preserve creator attribution and modification record. The asset remains a named-agent visual, not an ambient villager.
