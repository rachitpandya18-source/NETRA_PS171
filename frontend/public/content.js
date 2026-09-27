(() => {
  const vault = new Map();

  let profile = {};
  let tokenCounters = {};

  function esc(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function loadProfile() {
    try {
      const r = await chrome.storage.local.get("netraProfile");
      profile = r.netraProfile || {};
    } catch (_) {
      profile = {};
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.netraProfile) {
      profile = changes.netraProfile.newValue || {};
    }
  });

  function classifyPII(value, hint = "") {
    const s = String(value || "").trim();
    const h = String(hint || "").toLowerCase();

    if (!s) return null;

    if (
      h.includes("password") ||
      h.includes("passwd")
    ) {
      return "PASSWORD";
    }

    if (
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ||
      h.includes("email")
    ) {
      return "EMAIL";
    }

    if (
      /^\+?\d[\d\s().-]{8,}\d$/.test(s) ||
      h.includes("phone") ||
      h.includes("mobile") ||
      h.includes("tel")
    ) {
      return "PHONE";
    }

    if (
      /^\d{4}\s?\d{4}\s?\d{4}$/.test(s) ||
      h.includes("aadhaar")
    ) {
      return "AADHAAR";
    }

    if (
      /^[A-Z]{5}\d{4}[A-Z]$/i.test(s) ||
      h.includes("pan")
    ) {
      return "PAN";
    }

    if (/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(value.trim()) || /ifsc|bank.*code/i.test(hint)) {
      return "IFSC";
    }

    if (
      /^[\w.-]+@[\w.-]+$/.test(s) ||
      h.includes("upi")
    ) {
      return "UPI";
    }

    if (
      h.includes("name") ||
      h.includes("username")
    ) {
      return "NAME";
    }

    return null;
  }

  function nextToken(kind) {
    tokenCounters[kind] = (tokenCounters[kind] || 0) + 1;
    return `[${kind}_${tokenCounters[kind]}]`;
  }

  function profileToken(kind) {
    const token = `[${kind}_1]`;

    const field = {
      FIRST_NAME: "firstName",
      LAST_NAME: "lastName",
      EMAIL: "email",
      PHONE: "phone"
    }[kind];

    if (field && profile[field]) {
      vault.set(token, profile[field]);
      return token;
    }

    return null;
  }

  function profileForHint(hint, inputType = "") {
    const h = String(hint || "").toLowerCase();

    if (
      /email|e-mail/.test(h) ||
      inputType === "email"
    ) {
      return {
        kind: "EMAIL",
        value: profile.email || ""
      };
    }

    if (
      /phone|mobile|tel/.test(h) ||
      inputType === "tel"
    ) {
      return {
        kind: "PHONE",
        value: profile.phone || ""
      };
    }

    if (
      /last[\s_-]*name|surname|family[\s_-]*name/.test(h)
    ) {
      return {
        kind: "LAST_NAME",
        value: profile.lastName || ""
      };
    }

    if (
      /first[\s_-]*name|given[\s_-]*name/.test(h)
    ) {
      return {
        kind: "FIRST_NAME",
        value: profile.firstName || ""
      };
    }

    if (
      /full[\s_-]*name|username/.test(h)
    ) {
      return {
        kind: "FIRST_NAME",
        value: profile.firstName || profile.name || ""
      };
    }

    return null;
  }

  function rectFor(el) {
    const r = el.getBoundingClientRect();

    return {
      x: Math.max(0, r.left),
      y: Math.max(0, r.top),
      width: Math.max(0, r.width),
      height: Math.max(0, r.height)
    };
  }

  function roleFor(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();

    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";

    if (
      tag === "button" ||
      (
        tag === "input" &&
        ["submit", "button", "reset"].includes(type)
      )
    ) {
      return "button";
    }

    if (tag === "a") return "link";
    if (tag === "select") return "combobox";

    if (
      tag === "textarea" ||
      tag === "input"
    ) {
      return "textbox";
    }

    if (/^h[1-6]$/.test(tag)) {
      return "heading";
    }

    return el.getAttribute("role") || "generic";
  }

  function safeName(el) {
    const id = el.getAttribute("id");

    const label = id
      ? document
        .querySelector(`label[for="${CSS.escape(id)}"]`)
        ?.innerText
        ?.trim()
      : "";

    return (
      label ||
      el.getAttribute("aria-label") ||
      el.getAttribute("name") ||
      el.getAttribute("placeholder") ||
      el.innerText?.trim().slice(0, 120) ||
      ""
    );
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      parseFloat(style.opacity || "1") > 0 &&
      r.width > 0 &&
      r.height > 0
    );
  }

  async function collect() {
    await loadProfile();

    const nodes = [];
    const piiBoxes = [];
    const tokenMap = {};

    const elements = Array.from(
      document.querySelectorAll(
        "input, textarea, select, button, a, [role], h1, h2, h3, h4, h5, h6"
      )
    );

    let index = 0;

    elements.forEach((el) => {
      if (!isVisible(el)) return;

      const rect = rectFor(el);

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const ref = `el_${index++}`;

      const hint = [
        safeName(el),
        el.getAttribute("id") || "",
        el.getAttribute("name") || "",
        el.getAttribute("placeholder") || "",
        el.getAttribute("aria-label") || "",
        el.getAttribute("type") || ""
      ]
        .join(" ")
        .trim();

      let text = "";

      /*
       * INPUT / TEXTAREA
       */
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        const value = el.value || "";
        const inputType =
          (el.getAttribute("type") || "").toLowerCase();

        /*
         * Existing value:
         * classify and tokenize locally.
         */
        const kind = classifyPII(value, hint);

        if (kind) {
          const token = nextToken(kind);

          vault.set(token, value);

          tokenMap[token] = kind.toLowerCase();

          piiBoxes.push({
            entity_type: kind,
            confidence: 0.99,
            box: rect
          });

          text = token;
        } else {
          /*
           * EMPTY INPUT:
           *
           * Check whether this field corresponds to a
           * locally saved profile value.
           *
           * Example:
           * First Name -> [FIRST_NAME_1]
           * Last Name  -> [LAST_NAME_1]
           * Email      -> [EMAIL_1]
           * Phone      -> [PHONE_1]
           *
           * Only the token is exposed to the planner.
           * Actual value stays inside local vault.
           */
          const profileField = profileForHint(
            hint,
            inputType
          );

          if (profileField?.value) {
            const token =
              `[${profileField.kind}_1]`;

            vault.set(
              token,
              profileField.value
            );

            tokenMap[token] =
              profileField.kind.toLowerCase();

            text = token;
          } else {
            /*
             * No saved profile value.
             *
             * Example:
             * Comments textarea
             */
            text = "";
          }
        }
      }

      /*
       * SELECT
       */
      else if (el instanceof HTMLSelectElement) {
        text =
          el.options[el.selectedIndex]?.text ||
          "";
      }

      /*
       * OTHER ELEMENTS
       */
      else {
        const raw =
          (el.innerText || "").trim();

        const kind =
          classifyPII(raw, hint);

        if (kind) {
          const token = nextToken(kind);

          vault.set(token, raw);

          tokenMap[token] =
            kind.toLowerCase();

          piiBoxes.push({
            entity_type: kind,
            confidence: 0.99,
            box: rect
          });

          text = token;
        } else {
          text = raw.slice(0, 500);
        }
      }

      nodes.push({
        id: ref,
        role: roleFor(el),
        name: safeName(el),
        text,

        value:
          el instanceof HTMLInputElement
            ? (el.value || "")
            : "",

        value_present:
          (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement
          )
            ? !!String(el.value || "").trim()
            : false,

        type: el.getAttribute("type") || "",

        bbox: [
          rect.x,
          rect.y,
          rect.x + rect.width,
          rect.y + rect.height
        ],

        disabled: !!el.disabled,
        visible: true
      });

      el.dataset.netraRef = ref;
    });

    return {
      url: location.href,
      title: document.title,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      device_pixel_ratio:
        window.devicePixelRatio || 1,
      nodes,
      piiBoxes,
      tokenMap
    };
  }

  function dispatchValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

    const setter =
      Object.getOwnPropertyDescriptor(
        proto,
        "value"
      )?.set;

    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(
      new Event("input", {
        bubbles: true
      })
    );

    el.dispatchEvent(
      new Event("change", {
        bubbles: true
      })
    );
  }

  function execute(action) {
    const el = action?.target_id
      ? document.querySelector(
        `[data-netra-ref="${CSS.escape(action.target_id)}"]`
      )
      : null;

    if (!el) {
      return {
        ok: false,
        error: "Target element not found"
      };
    }

    /*
     * CLICK
     */
    if (action.action_type === "CLICK") {
      if (el.disabled) {
        return {
          ok: false,
          error: "Target element is disabled"
        };
      }

      const beforeUrl = location.href;

      let clickSeen = false;
      let submitSeen = false;

      const onClick = () => {
        clickSeen = true;
      };

      const onSubmit = () => {
        submitSeen = true;
      };

      // Verify that the actual resolved DOM element
      // receives the click event.
      el.addEventListener(
        "click",
        onClick,
        {
          once: true,
          capture: true
        }
      );

      // If this element belongs to a form,
      // verify whether the form actually receives submit.
      const form = el.closest("form");

      if (form) {
        form.addEventListener(
          "submit",
          onSubmit,
          {
            once: true,
            capture: true
          }
        );
      }

      // Actual DOM click.
      el.click();

      // Remove temporary listeners.
      el.removeEventListener(
        "click",
        onClick,
        true
      );

      if (form) {
        form.removeEventListener(
          "submit",
          onSubmit,
          true
        );
      }

      const urlChanged =
        location.href !== beforeUrl;

      return {
        ok:
          clickSeen ||
          submitSeen ||
          urlChanged,

        clicked: clickSeen,

        submitted: submitSeen,

        url_changed: urlChanged,

        target: {
          tag: el.tagName,
          type:
            el.getAttribute("type") || "",
          id:
            el.getAttribute("id") || "",
          name:
            el.getAttribute("name") || "",
          value:
            el instanceof HTMLInputElement
              ? (el.value || "")
              : "",
          text:
            (
              el.innerText ||
              el.textContent ||
              ""
            )
              .trim()
              .slice(0, 120),

          netra_ref:
            el.dataset.netraRef || ""
        }
      };
    }

    /*
     * TYPE
     */
    if (action.action_type === "TYPE") {
      let token = action.value;
      let value = token
        ? vault.get(token)
        : null;

      /*
       * If planner gave a token that isn't currently
       * in the vault, resolve the field locally again.
       */
      if (!value) {
        const hint = [
          safeName(el),
          el.getAttribute("id") || "",
          el.getAttribute("name") || "",
          el.getAttribute("placeholder") || "",
          el.getAttribute("aria-label") || ""
        ]
          .join(" ")
          .trim();

        const inputType =
          (el.getAttribute("type") || "")
            .toLowerCase();

        const p =
          profileForHint(
            hint,
            inputType
          );

        if (p?.value) {
          token =
            `[${p.kind}_1]`;

          vault.set(
            token,
            p.value
          );

          value = p.value;
        }
      }

      if (!value) {
        return {
          ok: false,
          error:
            "No matching local-vault profile value for this field"
        };
      }

      dispatchValue(
        el,
        value
      );

      return {
        ok: true,
        used_local_vault: true,
        token
      };
    }

    return {
      ok: false,
      error: "Unsupported action"
    };
  }

  /*
   * MESSAGE HANDLER
   */
  chrome.runtime.onMessage.addListener(
    (msg, sender, sendResponse) => {

      if (msg.type === "NETRA_SNAPSHOT") {
        collect()
          .then((snapshot) => {
            sendResponse({
              ok: true,
              snapshot
            });
          })
          .catch((e) => {
            sendResponse({
              ok: false,
              error: String(e)
            });
          });

        return true;
      }

      if (msg.type === "NETRA_EXECUTE") {
        try {
          sendResponse(
            execute(msg.action)
          );
        } catch (e) {
          sendResponse({
            ok: false,
            error: String(e)
          });
        }

        return true;
      }
    }
  );

  /*
   * Initialize local profile immediately.
   */
  loadProfile();

})();
