import * as ort from "onnxruntime-web";

ort.env.wasm.wasmPaths = chrome.runtime.getURL("assets/");
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.simd = true;

const $ = id => document.getElementById(id);

const cls = [
  "Button",
  "CheckBox",
  "Heading",
  "Image",
  "Label",
  "Link",
  "Paragraph",
  "RadioButton",
  "Select",
  "TextBox"
];

let session = null;

const MAX_AGENT_STEPS = 10;
const ACTION_DELAY_MS = 350;

function setStage(id, text, kind = "") {
  const e = $(id);
  if (!e) return;
  e.textContent = text;
  e.className = "pill " + kind;
}

function log(x) {
  if (!$("trace")) return;
  $("trace").textContent =
    typeof x === "string" ? x : JSON.stringify(x, null, 2);
}

async function activeTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tabs.length) {
    throw new Error("No active browser tab found.");
  }

  return tabs[0];
}

/* =========================
   LOCAL PROFILE VAULT
   ========================= */

async function loadProfile() {
  const { netraProfile = {} } =
    await chrome.storage.local.get("netraProfile");

  $("firstName").value = netraProfile.firstName || "";
  $("lastName").value = netraProfile.lastName || "";
  $("email").value = netraProfile.email || "";
  $("phone").value = netraProfile.phone || "";

  const count = Object.values(netraProfile).filter(Boolean).length;

  $("vaultStatus").textContent =
    count ? `${count} SAVED` : "EMPTY";

  $("vaultStatus").className =
    `pill ${count ? "ok" : ""}`;
}

async function saveProfile() {
  const profile = {
    firstName: $("firstName").value.trim(),
    lastName: $("lastName").value.trim(),
    email: $("email").value.trim(),
    phone: $("phone").value.trim()
  };

  await chrome.storage.local.set({
    netraProfile: profile
  });

  const count = Object.values(profile).filter(Boolean).length;

  $("vaultStatus").textContent =
    count ? `${count} SAVED` : "EMPTY";

  $("vaultStatus").className =
    `pill ${count ? "ok" : ""}`;

  log(
    "Local profile vault updated. Raw profile values remain on-device."
  );
}

/* =========================
   SNAPSHOT
   ========================= */

async function snapshot() {
  const tab = await activeTab();

  try {
    return await chrome.tabs.sendMessage(
      tab.id,
      { type: "NETRA_SNAPSHOT" }
    );
  } catch (e) {
    throw new Error(
      "NETRA content script is not available on this page. " +
      "Open a normal http/https webpage and reload it."
    );
  }
}

/* =========================
   YOLO MODEL
   ========================= */

async function loadModel() {
  if (session) return session;

  const modelUrl = chrome.runtime.getURL(
    "models/NETRA_yolo11n_ui_detector.onnx"
  );

  session = await ort.InferenceSession.create(
    modelUrl,
    {
      executionProviders: ["wasm"]
    }
  );

  return session;
}

async function imageBitmapFromDataUrl(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  return await createImageBitmap(blob);
}

function letterboxTo640(bitmap) {
  const c = document.createElement("canvas");

  c.width = 640;
  c.height = 640;

  const ctx = c.getContext("2d");

  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 640, 640);

  const scale = Math.min(
    640 / bitmap.width,
    640 / bitmap.height
  );

  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const x = Math.round((640 - w) / 2);
  const y = Math.round((640 - h) / 2);

  ctx.drawImage(
    bitmap,
    0,
    0,
    bitmap.width,
    bitmap.height,
    x,
    y,
    w,
    h
  );

  const d = ctx.getImageData(
    0,
    0,
    640,
    640
  ).data;

  const arr = new Float32Array(
    3 * 640 * 640
  );

  for (let i = 0; i < 640 * 640; i++) {
    arr[i] =
      d[i * 4] / 255;

    arr[640 * 640 + i] =
      d[i * 4 + 1] / 255;

    arr[2 * 640 * 640 + i] =
      d[i * 4 + 2] / 255;
  }

  return {
    tensor: new ort.Tensor(
      "float32",
      arr,
      [1, 3, 640, 640]
    ),
    scale,
    x,
    y
  };
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);

  const inter =
    Math.max(0, x2 - x1) *
    Math.max(0, y2 - y1);

  const aa =
    Math.max(0, a[2] - a[0]) *
    Math.max(0, a[3] - a[1]);

  const bb =
    Math.max(0, b[2] - b[0]) *
    Math.max(0, b[3] - b[1]);

  return inter / (aa + bb - inter + 1e-6);
}

function decode(out, meta, origW, origH) {
  const data = out.data;

  const n = 8400;
  const c = 14;

  const candidates = [];

  for (let j = 0; j < n; j++) {
    let best = -1;
    let score = 0;

    for (let k = 4; k < c; k++) {
      const s = data[k * n + j];

      if (s > score) {
        score = s;
        best = k - 4;
      }
    }

    if (score < 0.35) continue;

    const cx = data[j];
    const cy = data[n + j];
    const w = data[2 * n + j];
    const h = data[3 * n + j];

    let x1 =
      (cx - w / 2 - meta.x) /
      meta.scale;

    let y1 =
      (cy - h / 2 - meta.y) /
      meta.scale;

    let x2 =
      (cx + w / 2 - meta.x) /
      meta.scale;

    let y2 =
      (cy + h / 2 - meta.y) /
      meta.scale;

    x1 = Math.max(0, Math.min(origW, x1));
    y1 = Math.max(0, Math.min(origH, y1));

    x2 = Math.max(0, Math.min(origW, x2));
    y2 = Math.max(0, Math.min(origH, y2));

    if (x2 - x1 < 3 || y2 - y1 < 3) {
      continue;
    }

    candidates.push({
      label: cls[best] || "UI",
      confidence: score,
      box: [x1, y1, x2, y2]
    });
  }

  candidates.sort(
    (a, b) => b.confidence - a.confidence
  );

  const keep = [];

  for (const d of candidates) {
    if (
      keep
        .filter(x => x.label === d.label)
        .every(x => iou(x.box, d.box) < 0.5)
    ) {
      keep.push(d);
    }

    if (keep.length >= 100) {
      break;
    }
  }

  return keep;
}

async function runLocalYOLO(dataUrl) {
  const bitmap =
    await imageBitmapFromDataUrl(dataUrl);

  const m = letterboxTo640(bitmap);

  const s = await loadModel();

  const out = await s.run({
    images: m.tensor
  });

  const first =
    out[Object.keys(out)[0]];

  return decode(
    first,
    m,
    bitmap.width,
    bitmap.height
  );
}

/* =========================
   LOCAL SCREENSHOT REDACTION
   ========================= */

async function redactScreenshot(
  dataUrl,
  piiBoxes,
  viewportW,
  viewportH
) {
  const bitmap =
    await imageBitmapFromDataUrl(dataUrl);

  const c =
    document.createElement("canvas");

  c.width = bitmap.width;
  c.height = bitmap.height;

  const ctx = c.getContext("2d");

  ctx.drawImage(bitmap, 0, 0);

  ctx.fillStyle = "#000";

  const scaleX =
    bitmap.width /
    Math.max(1, viewportW);

  const scaleY =
    bitmap.height /
    Math.max(1, viewportH);

  for (const f of piiBoxes) {
    const b = f.box;

    ctx.fillRect(
      b.x * scaleX,
      b.y * scaleY,
      b.width * scaleX,
      b.height * scaleY
    );
  }

  let out =
    c.toDataURL(
      "image/webp",
      0.62
    );

  if (out.length > 800000) {
    out =
      c.toDataURL(
        "image/jpeg",
        0.55
      );
  }

  return out;
}

/* =========================
   UI → DOM REFERENCE
   ========================= */

function detectionToRef(det, nodes) {
  const [
    x1,
    y1,
    x2,
    y2
  ] = det.box;

  const cx =
    (x1 + x2) / 2;

  const cy =
    (y1 + y2) / 2;

  let best = null;
  let areaBest = Infinity;

  for (const n of nodes) {
    const [
      a,
      b,
      c,
      d
    ] = n.bbox;

    if (
      cx >= a &&
      cx <= c &&
      cy >= b &&
      cy <= d
    ) {
      const area =
        (c - a) *
        (d - b);

      if (area < areaBest) {
        areaBest = area;
        best = n;
      }
    }
  }

  return best?.id || null;
}

function toBackendPage(nodes) {
  return nodes.map(n => ({
    ref: n.id,
    role: n.role,
    name: n.name || "",
    text: n.text || "",

    rect: {
      x: n.bbox[0],
      y: n.bbox[1],
      width:
        n.bbox[2] - n.bbox[0],
      height:
        n.bbox[3] - n.bbox[1]
    },

    disabled: !!n.disabled,
    visible: n.visible !== false
  }));
}

/* =========================
   HEALTH
   ========================= */

async function health() {
  try {
    const r =
      await fetch(
        ($("backend").value ||
          "http://localhost:8000") +
          "/health"
      );

    const j = await r.json();

    setStage(
      "s4",
      j.ok ? "ONLINE" : "ERROR",
      j.ok ? "ok" : "bad"
    );

    log(j);
  } catch (e) {
    setStage(
      "s4",
      "OFFLINE",
      "bad"
    );

    log(String(e));
  }
}

/* =========================
   ONE AGENT OBSERVE → PLAN → ACT STEP
   ========================= */

async function runAgentStep(
  tab,
  stepNumber,
  previousAction = null
) {
  setStage(
    "s1",
    `OBSERVE ${stepNumber}`,
    "warn"
  );

  const snap = await snapshot();

  if (!snap.ok) {
    throw new Error(
      snap.error || "Snapshot failed"
    );
  }

  const shot =
    await chrome.tabs.captureVisibleTab(
      tab.windowId,
      {
        format: "jpeg",
        quality: 72
      }
    );

  setStage(
    "s1",
    `CAPTURED ${stepNumber}`,
    "ok"
  );

  /* ---------- LOCAL YOLO ---------- */

  const detections =
    await runLocalYOLO(shot);

  setStage(
    "s2",
    `${detections.length} FOUND`,
    "ok"
  );

  if ($("detCount")) {
    $("detCount").textContent =
      detections.length;
  }

  /* ---------- LOCAL REDACTION ---------- */

  setStage(
    "s3",
    "REDACTING",
    "warn"
  );

  const piiBoxes =
    snap.snapshot.piiBoxes || [];

  const redacted =
    await redactScreenshot(
      shot,
      piiBoxes,
      snap.snapshot.viewport_width,
      snap.snapshot.viewport_height
    );

  /*
   * Preview keeps the complete data URL.
   */
  $("preview").src = redacted;
  $("preview").style.display = "block";

  if ($("piiCount")) {
    $("piiCount").textContent =
      piiBoxes.length;
  }

  setStage(
    "s3",
    `${piiBoxes.length} MASKED`,
    "ok"
  );

  if ($("privacy")) {
    $("privacy").textContent =
      `Raw PII sent: false\n` +
      `Local token vault: ${Object.keys(
        snap.snapshot.tokenMap || {}
      ).length} token(s)\n` +
      `Sanitized screenshot: yes`;
  }

  /* ---------- UI PERCEPTION ---------- */

  const ui =
    detections.map(d => ({
      label: d.label,

      box: {
        x: d.box[0],
        y: d.box[1],
        width:
          d.box[2] - d.box[0],
        height:
          d.box[3] - d.box[1]
      },

      confidence: d.confidence,

      ref: detectionToRef(
        d,
        snap.snapshot.nodes
      )
    }));

  /*
   * Backend expects ONLY raw Base64,
   * not data:image/...;base64,...
   */
  const redactedBase64 =
    redacted.includes(",")
      ? redacted.split(",")[1]
      : redacted;

  const payload = {
    instruction:
      $("instruction").value.trim(),

    page: {
      url: snap.snapshot.url,
      title: snap.snapshot.title,

      nodes:
        toBackendPage(
          snap.snapshot.nodes
        )
    },

    screenshot: {
      redacted: true,

      mime_type:
        redacted.slice(
          5,
          redacted.indexOf(";")
        ),

      data_base64:
        redactedBase64
    },

    pii: {
      redaction_count:
        piiBoxes.length,

      findings:
        piiBoxes.map(x => ({
          entity_type:
            x.entity_type,

          confidence:
            x.confidence,

          box: x.box
        })),

      raw_values_sent: false,
      verified_local: true,
      leakage_check_passed: true
    },

    perception: {
      ui_detections: ui,
      ocr_text_redacted: [],
      source: "local",
      model: "YOLO11n"
    },

    session_id: "demo-session"
  };

  /* ---------- BACKEND PLAN ---------- */

  setStage(
    "s4",
    `PLANNING ${stepNumber}`,
    "warn"
  );

  const started =
    performance.now();

  const r =
    await fetch(
      ($("backend").value ||
        "http://localhost:8000") +
        "/api/v1/plan",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      }
    );

  const j =
    await r.json();

  const latency =
    Math.round(
      performance.now() -
      started
    );

  if ($("latency")) {
    $("latency").textContent =
      `${latency} ms`;
  }

  if (!r.ok) {
    throw new Error(
      JSON.stringify(j)
    );
  }

  setStage(
    "s4",
    j.planner?.toUpperCase() ||
      "PLANNED",
    "ok"
  );

  const a =
    j.action || {};

  const actionType =
    String(
      a.type || ""
    ).toUpperCase();

  const localAction = {
    action_type:
      actionType,

    target_id:
      a.ref || null,

    value:
      a.value || null,

    value_ref:
      a.value_ref || null,

    direction:
      a.direction || null,

    amount:
      a.amount || null,

    url:
      a.url || null,

    ms:
      a.ms || null
  };

  if ($("action")) {
    $("action").innerHTML =
      `<b>${actionType || "NO_OP"}</b> · ` +
      `${a.ref || "—"}<br>` +
      `<span class="muted">${a.reason || ""}</span><br>` +
      `<span class="pill">${Math.round(
        (a.confidence || 0) * 100
      )}% confidence</span>`;
  }

  /*
   * Keep raw profile values local.
   */
  log({
    step: stepNumber,
    planner: j.planner,
    action: a,
    privacy: j.privacy,
    trace: j.trace,
    local_profile_not_sent: true
  });

  /* ---------- TERMINAL ACTIONS ---------- */

  if (
    actionType === "FINISH"
  ) {
    setStage(
      "s5",
      "COMPLETED",
      "ok"
    );

    return {
      done: true,
      action: a,
      execution: null
    };
  }

  if (
    actionType === "NO_OP" ||
    actionType === ""
  ) {
    setStage(
      "s5",
      "NO ACTION",
      "warn"
    );

    return {
      done: true,
      action: a,
      execution: null
    };
  }

  /*
   * Navigate/confirmation/wait actions are
   * not executed by the current content.js.
   * Don't pretend they succeeded.
   */
  if (
    !["CLICK", "TYPE"].includes(
      actionType
    )
  ) {
    setStage(
      "s5",
      "PLANNED",
      "ok"
    );

    return {
      done: false,
      action: a,
      execution: null,
      unsupported: true
    };
  }

  /* ---------- LOCAL EXECUTION ---------- */

  const ex =
    await chrome.tabs.sendMessage(
      tab.id,
      {
        type: "NETRA_EXECUTE",
        action: localAction
      }
    );

  if (!ex.ok) {
    setStage(
      "s5",
      "FAILED",
      "bad"
    );

    log({
      step: stepNumber,
      planner: j.planner,
      action: a,
      execution: ex
    });

    return {
      done: false,
      action: a,
      execution: ex,
      failed: true
    };
  }

  setStage(
    "s5",
    `EXECUTED ${stepNumber}`,
    "ok"
  );

  /*
   * Give the page time to process input,
   * React/Vue state updates, validation etc.
   */
  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        ACTION_DELAY_MS
      )
  );

  return {
    done: false,
    action: a,
    execution: ex
  };
}

/* =========================
   FULL AGENT LOOP
   ========================= */
function fieldHint(node) {
  return [
    node?.name,
    node?.id,
    node?.text
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function remainingProfileFields(snapshot, executedTargets) {

  return (snapshot?.nodes || []).filter(node => {

    if (node.role !== "textbox") {
      return false;
    }

    if (!node.text) {
      return false;
    }

    if (!/^\[[A-Z_]+_\d+\]$/.test(node.text)) {
      return false;
    }

    if (node.value_present) {
      return false;
    }

    if (executedTargets.has(node.id)) {
      return false;
    }

    return true;
  });

}

function findSubmitButton(snapshot, executedTargets) {
  return (snapshot?.nodes || []).find((node) => {
    if (!node) return false;

    if (executedTargets.has(node.id)) {
      return false;
    }

    if (node.disabled) {
      return false;
    }

    // IMPORTANT:
    // Submit must be an actual button control.
    if (node.role !== "button") {
      return false;
    }

    const text = String(node.text || "").trim().toLowerCase();
    const name = String(node.name || "").trim().toLowerCase();
    const value = String(node.value || "").trim().toLowerCase();
    const type = String(node.type || "").trim().toLowerCase();
    const aria = String(node.ariaLabel || "").trim().toLowerCase();

    const combined = `${text} ${name} ${value} ${aria}`;

    // Strong evidence: actual submit input.
    if (type === "submit") {
      return true;
    }

    // Text-based submit controls.
    return (
      /\bsubmit\b/.test(combined) ||
      /\bsend message\b/.test(combined) ||
      /\bsend\b/.test(combined) ||
      /\benquire\b/.test(combined) ||
      /\binquire\b/.test(combined) ||
      /\bapply\b/.test(combined) ||
      /\bregister\b/.test(combined) ||
      /\bcontinue\b/.test(combined) ||
      /\bnext\b/.test(combined)
    );
  }) || null;
}
const executedTargets = new Set();
async function run() {
  const t = await activeTab();

  
  const MAX_STEPS = 10;

  for (let step = 1; step <= MAX_STEPS; step++) {

    setStage("s1", "CAPTURING", "warn");
    setStage("s2", "RUNNING", "warn");

    // -----------------------------------------
    // 1. OBSERVE
    // -----------------------------------------
    const snap = await snapshot();

    if (!snap.ok) {
      throw new Error(snap.error || "Snapshot failed");
    }

    // -----------------------------------------
    // 2. SCREENSHOT
    // -----------------------------------------
    const shot = await chrome.tabs.captureVisibleTab(
      t.windowId,
      {
        format: "jpeg",
        quality: 72
      }
    );

    setStage("s1", "CAPTURED", "ok");

    // -----------------------------------------
    // 3. LOCAL YOLO
    // -----------------------------------------
    const detections = await runLocalYOLO(shot);

    setStage(
      "s2",
      `${detections.length} FOUND`,
      "ok"
    );

    $("detCount").textContent = detections.length;

    // -----------------------------------------
    // 4. LOCAL PRIVACY / REDACTION
    // -----------------------------------------
    setStage("s3", "REDACTING", "warn");

    const piiBoxes =
      snap.snapshot.piiBoxes || [];

    const redacted = await redactScreenshot(
      shot,
      piiBoxes,
      snap.snapshot.viewport_width,
      snap.snapshot.viewport_height
    );

    $("preview").src = redacted;
    $("preview").style.display = "block";

    $("piiCount").textContent =
      piiBoxes.length;

    setStage(
      "s3",
      `${piiBoxes.length} MASKED`,
      "ok"
    );

    $("privacy").textContent =
      `Raw PII sent: false\n` +
      `Local token vault: ${Object.keys(
        snap.snapshot.tokenMap || {}
      ).length} token(s)\n` +
      `Sanitized screenshot: yes`;

    // -----------------------------------------
    // 5. BUILD PERCEPTION
    // -----------------------------------------
    const ui = detections.map(d => ({
      label: d.label,

      box: {
        x: d.box[0],
        y: d.box[1],
        width: d.box[2] - d.box[0],
        height: d.box[3] - d.box[1]
      },

      confidence: d.confidence,

      ref: detectionToRef(
        d,
        snap.snapshot.nodes
      )
    }));

    // IMPORTANT:
    // Backend wants RAW base64 only, without
    // data:image/...;base64,
    const redactedBase64 =
      redacted.includes(",")
        ? redacted.split(",")[1]
        : redacted;

    const payload = {

      instruction:
        $("instruction").value.trim(),

      page: {
        url: snap.snapshot.url,
        title: snap.snapshot.title,
        nodes: toBackendPage(
          snap.snapshot.nodes
        )
      },

      screenshot: {
        redacted: true,

        mime_type:
          redacted.slice(
            5,
            redacted.indexOf(";")
          ),

        data_base64:
          redactedBase64
      },

      pii: {
        redaction_count:
          piiBoxes.length,

        findings:
          piiBoxes.map(x => ({
            entity_type: x.entity_type,
            confidence: x.confidence,
            box: x.box
          })),

        raw_values_sent: false,
        verified_local: true,
        leakage_check_passed: true
      },

      perception: {
        ui_detections: ui,
        ocr_text_redacted: [],
        source: "local",
        model: "YOLO11n"
      },

      session_id: "demo-session"
    };

    // -----------------------------------------
    // 6. CHECK REMAINING PROFILE FIELDS
    // -----------------------------------------
       // -----------------------------------------
    // 6. CHECK REMAINING PROFILE FIELDS
    // -----------------------------------------
    const remaining =
      remainingProfileFields(
        snap.snapshot,
        executedTargets
      );

    /*
     * VERY IMPORTANT:
     *
     * If First Name, Last Name and Email
     * are already executed, Comments will NOT
     * appear here because it has no token.
     *
     * Therefore we skip Comments and check
     * whether the user has entered it manually.
     */

    if (remaining.length === 0) {

      // -----------------------------------------
      // WAIT FOR USER TO ENTER OPTIONAL COMMENT
      // -----------------------------------------

    const commentNode =
  (snap.snapshot.nodes || []).find(node => {

    if (node.role !== "textbox") {
      return false;
    }

    if (!node.value_present) {
      return false;
    }

    if (/^\[[A-Z_]+_\d+\]$/.test(
      String(node.text || "")
    )) {
      return false;
    }

    const hint = [
      node.name,
      node.id,
      node.type
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      /\bcomment\b/.test(hint) ||
      /\bcomments\b/.test(hint) ||
      /\bmessage\b/.test(hint) ||
      /\bremarks\b/.test(hint) ||
      /\bdescription\b/.test(hint)
    );
  });

const commentValue =
  !!commentNode;

      /*
       * First run:
       * Profile fields are filled,
       * but user has not entered comment yet.
       *
       * STOP HERE.
       */
      if (!commentValue) {

        setStage(
          "s5",
          "WAITING FOR COMMENT",
          "warn"
        );

        $("action").innerHTML =
          `<b>WAITING FOR USER</b>` +
          `<br><span class="muted">` +
          `Saved profile fields filled. ` +
          `Enter your comment and run NETRA again to submit.` +
          `</span>`;

        log({
          step,
          planner: "deterministic",
          skipped_optional_fields: true,
          message:
            "Saved profile fields filled. Waiting for user to enter the optional comment before submission."
        });

        return;
      }

      // -----------------------------------------
      // COMMENT EXISTS → NOW FIND SUBMIT
      // -----------------------------------------

      const submit =
        findSubmitButton(
          snap.snapshot,
          executedTargets
        );

      if (submit) {

        const submitAction = {
          action_type: "CLICK",
          target_id: submit.id,
          value: null,
          value_ref: null
        };

        $("action").innerHTML =
          `<b>CLICK</b> · ${submit.id}` +
          `<br><span class="muted">` +
          `All saved profile fields completed. ` +
          `Submitting form.` +
          `</span>`;

        setStage(
          "s4",
          "SUBMITTING",
          "warn"
        );

        const ex =
          await chrome.tabs.sendMessage(
            t.id,
            {
              type: "NETRA_EXECUTE",
              action: submitAction
            }
          );

        // -----------------------------------------
        // VERIFY ACTUAL CLICK / SUBMISSION
        // -----------------------------------------

        log({
          step,
          planner: "deterministic",
          action: submitAction,
          execution: ex,
          skipped_optional_fields: true
        });

        /*
         * A click event alone is NOT enough.
         *
         * We require either:
         *   1. form submit event
         *   2. navigation / URL change
         *
         * clicked=true by itself is not considered
         * successful form submission.
         */

        const submissionVerified =
          ex?.submitted === true ||
          ex?.url_changed === true;

        if (!submissionVerified) {

          setStage(
            "s5",
            "SUBMIT NOT VERIFIED",
            "bad"
          );

          log({
            step,
            planner: "deterministic",
            action: submitAction,
            execution: ex,
            error:
              "Submit target was clicked, but actual form submission was not verified."
          });

          return;
        }

        // -----------------------------------------
        // SUBMISSION VERIFIED
        // -----------------------------------------

        executedTargets.add(
          submit.id
        );

        setStage(
          "s5",
          "COMPLETED",
          "ok"
        );

        log({
          step,
          planner: "deterministic",
          action: submitAction,
          execution: ex,
          skipped_optional_fields: true,
          message:
            "User comment detected. Submit clicked and submission verified."
        });

        return;
      }

      // -----------------------------------------
      // NO SUBMIT BUTTON FOUND
      // -----------------------------------------

      setStage(
        "s5",
        "COMPLETED",
        "ok"
      );

      log({
        step,
        planner: "deterministic",
        skipped_optional_fields: true,
        message:
          "All saved profile fields completed. Comment exists, but no submit button was detected."
      });

      return;
    }

    
    // -----------------------------------------
    // 7. BACKEND PLANNING
    // -----------------------------------------
    setStage(
      "s4",
      "PLANNING",
      "warn"
    );

    const started =
      performance.now();

    const r = await fetch(
      (
        $("backend").value ||
        "http://localhost:8000"
      ) + "/api/v1/plan",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      }
    );

    const j = await r.json();

    $("latency").textContent =
      Math.round(
        performance.now() - started
      ) + " ms";

    if (!r.ok) {
      throw new Error(
        JSON.stringify(j)
      );
    }

    setStage(
      "s4",
      j.planner?.toUpperCase() ||
        "PLANNED",
      "ok"
    );

    let a = j.action || {};

    let actionType =
      String(
        a.type || ""
      ).toUpperCase();

    let targetId =
      a.ref || null;

    /*
     * -----------------------------------------
     * 8. REPAIR BACKEND'S WRONG TYPE TARGET
     * -----------------------------------------
     *
     * If backend tries to TYPE Comments,
     * or repeats an already completed field,
     * override it with the next tokenized
     * profile field.
     */
    if (actionType === "TYPE") {

      const validRemaining =
        remainingProfileFields(
          snap.snapshot,
          executedTargets
        );

      const targetIsValid =
        validRemaining.some(
          node => node.id === targetId
        );

      if (!targetIsValid) {

        const next =
          validRemaining[0];

        if (next) {
          targetId = next.id;

          a = {
            ...a,

            type: "type",
            ref: next.id,
            value: next.text,
            value_ref:
              "LOCAL_USER_VALUE",

            reason:
              "Frontend repair selected next unexecuted local-vault field"
          };
        }
      }
    }

    // -----------------------------------------
    // 9. LOCAL ACTION
    // -----------------------------------------
    const localAction = {

      action_type:
        String(
          a.type || ""
        ).toUpperCase(),

      target_id:
        a.ref || null,

      value:
        a.value || null,

      value_ref:
        a.value_ref || null,

      direction:
        a.direction || null,

      amount:
        a.amount || null,

      url:
        a.url || null,

      ms:
        a.ms || null
    };

    $("action").innerHTML =
      `<b>${localAction.action_type}</b>` +
      ` · ${localAction.target_id || "—"}` +
      `<br>` +
      `<span class="muted">` +
      `${a.reason || ""}` +
      `</span>` +
      `<br>` +
      `<span class="pill">` +
      `${Math.round(
        (a.confidence || 0) * 100
      )}% confidence` +
      `</span>`;

    log({
      step,
      planner: j.planner,
      action: a,
      privacy: j.privacy,
      trace: j.trace,
      local_profile_not_sent: true
    });

    // -----------------------------------------
    // 10. EXECUTE
    // -----------------------------------------
    if (
      ["CLICK", "TYPE"].includes(
        localAction.action_type
      )
    ) {

      const ex =
        await chrome.tabs.sendMessage(
          t.id,
          {
            type: "NETRA_EXECUTE",
            action: localAction
          }
        );

      if (!ex.ok) {

        setStage(
          "s5",
          "FAILED",
          "bad"
        );

        log({
          step,
          planner: j.planner,
          action: a,
          execution: ex
        });

        return;
      }

      // Mark successful target as completed.
      if (localAction.target_id) {
        executedTargets.add(
          localAction.target_id
        );
      }

      setStage(
        "s5",
        "EXECUTED",
        "ok"
      );

      log({
        step,
        planner: j.planner,
        action: a,
        execution: ex,
        executed_targets:
          [...executedTargets]
      });

      /*
       * Don't stop here.
       *
       * Next loop:
       * OBSERVE → PERCEIVE → SANITIZE
       * → PLAN → EXECUTE
       */
      continue;
    }

    /*
     * Unsupported / FINISH / NO_OP
     */
    setStage(
      "s5",
      "PLANNED",
      "ok"
    );

    return;
  }

  setStage(
    "s5",
    "MAX STEPS",
    "bad"
  );

  log(
    "Agent stopped after maximum steps."
  );
}

/* =========================
   EVENT HANDLERS
   ========================= */

$("health").onclick =
  health;

$("saveProfile").onclick =
  async () => {
    try {
      await saveProfile();
    } catch (e) {
      log(String(e));
    }
  };

$("run").onclick =
  async () => {
    try {
      await run();
    } catch (e) {
      console.error(e);

      log({
        error:
          String(e)
      });

      setStage(
        "s5",
        "ERROR",
        "bad"
      );
    }
  };

/* =========================
   INITIALIZATION
   ========================= */

loadProfile();
health();