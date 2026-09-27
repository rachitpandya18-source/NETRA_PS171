
NETRA - YOLO11n Web UI Detector
================================

MODEL
-----
Model: YOLO11n
Task: Web UI Element Detection
Input: 640x640 RGB
ONNX Output: [1, 14, 8400]

CLASSES
-------
0 Button
1 CheckBox
2 Heading
3 Image
4 Label
5 Link
6 Paragraph
7 RadioButton
8 Select
9 TextBox

TRAINING
--------
Train images: 297
Validation images: 22
Max epochs: 100
Best epoch: 26
Early stopping: Epoch 46

VALIDATION RESULTS
------------------
Precision: 95.7%
Recall: 93.3%
mAP@50: 96.5%
mAP@50-95: 79.5%

HELD-OUT TEST
-------------
Images: 6
Objects: 149
Precision: 87.6%
Recall: 98.6%
mAP@50: 94.81%
mAP@50-95: 82.1%

IMPORTANT
---------
The held-out test split contains only 6 images / 149 objects.
These metrics are measured results for this test split and should
not be described as general real-world accuracy.

FILES
-----
models/
    NETRA_yolo11n_ui_detector.pt
    NETRA_yolo11n_ui_detector.onnx

training/
    results.csv
    results.png
    confusion_matrix.png
    PR_curve.png
    F1_curve.png
    P_curve.png
    R_curve.png

yolo_dataset/
    images/
    labels/
    data.yaml
