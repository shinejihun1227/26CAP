// Classic worker intentionally: the WASM loader uses importScripts().
let detector = null;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const { FilesetResolver, PoseLandmarker } = await import("/vendor/mediapipe/vision_bundle.mjs");
      const files = await FilesetResolver.forVisionTasks(new URL("/vendor/mediapipe/wasm", self.location.origin).href);
      detector = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL("/vendor/mediapipe/pose_landmarker_full.task", self.location.origin).href, delegate: "CPU" },
        runningMode: "VIDEO", numPoses: 2,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame" && detector) {
      const result = detector.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({ type: "result", timestamp: data.timestamp, poses: result.landmarks });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: String(error?.message || error) });
  } finally {
    data.bitmap?.close();
  }
};
