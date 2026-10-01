---
slug: satellite-image-change-detection
lang: en
source_lang: en
current: false
counterpart: ../fr/satellite-image-change-detection.md
---
# Satellite Image Change Detection

**Role:** Data Scientist
**Solutions:** YOLO, Fast R-CNN, Image Processing, Object Detection, Fine-tuning

## Description

Built, as an end-of-study project, an AI model spotting changes between 2014 and 2024 satellite images.
- Handled image preprocessing, adjusting the satellite images so the model could detect objects more easily.
- Took the single-pass side of the model search: chose YOLO for speed, then tuned its hyperparameters to improve results.
- Weighed results against multi-stage models: still less accurate, informing the move to Fast R-CNN, trading speed for accuracy.
